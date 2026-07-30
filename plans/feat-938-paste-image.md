# feat(#938): ターミナルに画像を貼り付けて絶対パスを挿入する

Chrome でスクリーンショットをエージェントに渡すのが「撮る → 保存する → ファイルボタン → ダイアログで探す」の
4手になっている。貼ったら保存され、絶対パスがカーソル位置に入る（送信はしない）を目指す。

挿入の作法は既存と同じ: D&D (#75) もファイルボタンも `insertText()` + `toShellArg()` に合流している。
画像 paste もそこへ合流させる。

## MulmoClaude との違い（これが設計の芯）

MulmoClaude にも同種の経路がある — `POST /api/attachments` が `{ dataUrl, filename }` を受け、
`data/attachments/YYYY/MM/<id>.<ext>` に保存してワークスペース相対パスを返す。**寄せない**。目的が違う。

| | MulmoClaude | MulmoTerminal |
| --- | --- | --- |
| 目的 | 添付を**資産として管理**する（チャットが後から参照する） | エージェントに**渡すだけ**（パスしか受け取れないから） |
| 保存先 | `data/attachments/YYYY/MM/` | `~/.mulmoterminal/tmp/pasted/` |
| 返す値 | ワークスペース相対パス | **絶対パス**（ターミナルに入る文字列そのもの） |
| 寿命 | 永続 | 使い捨て（起動時に 24h 超を削除 + 件数上限 200） |
| ルート | `POST /api/attachments` | `POST /api/paste-image` |

同じルート名に寄せると「管理された添付ストア」という意味まで持ち込んでしまう。意図的に分ける。
ソース側にもこの理由をコメントで残す（CLAUDE.md のリファレンスホスト規約）。

## 保存先を決めた根拠（実測）

`claude` / `codex` に、cwd 外の絶対パスの PNG を読ませて確認した:

| 保存先 | claude | codex |
| --- | --- | --- |
| `$TMPDIR` 配下 | `Claude requested permissions to read from ... but you haven't granted it yet.` | 読める |
| `~/.mulmoterminal` 配下 | 同上 | 読める |
| `--add-dir <dir>` を付けた場合 | 読める | — |
| セッションの cwd 配下 | 読める | 読める |

- **claude をブロックしているのは OS ではなく Claude Code 自身の作業ディレクトリ制限。** サーバは常に
  ホストで動くので OS 的には読める。cwd 外を渡すと対話モードでは貼るたびに許可プロンプトが出る —
  この issue が消そうとしている手数が別の形で戻る。
- **codex は制限なし。** サンドボックスは write のみを縛る（起動ログの
  `sandbox: workspace-write [workdir, /tmp, $TMPDIR]` は writable roots）。codex 側の変更は不要。

→ claude は cwd 外なら**保存先がどこであれ `--add-dir` が要る**。なので場所は「読めるか」ではなく
「ユーザーのものを汚さないか / 掃除できるか」で選ぶ。`~/.mulmoterminal/tmp/pasted/` にする:

- リポジトリを汚さない（cwd 配下だと `git status` に出る）
- `~/mulmoclaude`（= `CLAUDE_CWD`）は wiki / collections が載る**ユーザーのコンテンツ**で、MulmoClaude
  とも共有する。使い捨ての受け渡しファイルを混ぜない — 上の表で分けた区別に逆行する
- `~/.mulmoterminal` は `backups/` `sandbox/` `sounds/` が既に住むアプリ専用ホーム

## 実装

### サーバ

1. `server/files/paste-image-store.ts` — 保存先の決定と純粋なヘルパ
   - `PASTE_IMAGE_DIR` = `<MULMOTERMINAL_HOME>/tmp/pasted`
   - `preparePasteImageDir()` — 起動時に `mkdir -p` + 24h 超を削除。**docker の bind-mount より先に**
     **存在させる**必要がある（無いと docker が root 所有で作る）。
     全消しにしない理由: tmux セッションはサーバ再起動を生き延びるので、再起動前に渡したパスを
     まだ会話が持っている。2つ目のサーバ（`yarn dev` と併用）も同じディレクトリを共有する
   - `decodeImageDataUrl()` / `extensionForImageMime()` / `pasteImageFilename()` / `prunePasteImages()`
   - `withPasteImageDir()` — ユーザー設定の `addDirs` に paste ディレクトリを**足す**（後述）
2. `server/files/paste-image.ts` — `POST /api/paste-image`
   - body `{ dataUrl }` → `{ path: <絶対パス> }`
   - `image/png|jpeg|gif|webp` のみ。10MB 上限（`express.json` は 25MB、base64 は 4/3 に膨らむ）
   - `writeFileAtomic` で書く（部分書き込みを読ませない）
   - same-origin ガードは `app.use(sameOriginGuard(...))` が全ルートに掛かっているので個別実装しない

### `--add-dir` との共存（#908 と競合させない）

`dir.addDirs` はユーザーが `.mulmoterminal.json` に書いたもの。**置き換えず、末尾に足して重複を潰す**。

- `buildClaudeArgs` の `--add-dir` は可変長引数で argv の最後に置かれる → 追加しても位置の前提は壊れない
- `spawnSandboxEntry` にも**同じリスト**を渡す。sandbox は `addDirs` をそのまま
  `-v <dir>:<dir>` にするので、**マウントも自動で付いてくる**（sandbox 対応はこれで完了）
- `MAX_ADD_DIRS`(16) はユーザー入力の上限。アプリが足す1件はその後段なので、上限で落とさない
- codex は `--add-dir` を持たないが、読めるので何もしない（上の実測）

### クライアント

3. `src/components/pasteImage.ts` — 純粋関数
   - `pastedImageFile(clipboardData)`: 画像があり、**かつ `text/plain` が無い**ときだけ File を返す。
     スクリーンショットは画像のみ。ブラウザのページからのコピーは text/html + 画像を両方積むので、
     それを横取りすると今までのテキスト貼り付けが壊れる
4. `src/composables/usePasteImage.ts` — アップロードして `insertText(toShellArg(path))`
5. `Terminal.vue` — ターミナルのコンテナに capture フェーズの `@paste` を張る。xterm は textarea と
   element の両方に paste を持つので、祖先の capture が先に走る。画像のときだけ `preventDefault()`

### テスト

- `paste-image-store`: mime→拡張子、data URL のデコード、ファイル名、prune、addDirs のマージ
- `paste-image` ルート: 正常系 / 非画像 / 壊れた dataUrl / サイズ超過
- `buildClaudeArgs` + `buildDockerRunArgs`: paste ディレクトリが `--add-dir` と `-v` に載ること
- `pasteImage`（クライアント純粋関数）: 画像のみ / テキストのみ / 両方 / 空

### ドキュメント

- README のパス挿入の項に paste を追加
- `docs/guide/{en,ja}` の該当ページを両方

---

## 更新（2.7.0 マージ後）: 独自のアップロード経路をやめ、ドロップに統合した

上の設計は「MulmoTerminal 側に画像を受けるルートが無い」ことが前提だった。#993（PR #1055、2.7.0）が
**`POST /api/session/:id/drop`** を入れたことで、その前提が消えた。

そちらはブラウザがパスを渡さないドロップのために作られたもので、**クリップボードの画像はまさに
「パスを持たない File」**なので、同じルートがそのまま使える。2 つ目を残す理由が無い。

削除したもの:

| | 理由 |
| --- | --- |
| `server/files/paste-image.ts` | `POST /api/session/:id/drop` が同じ仕事をする |
| `server/files/paste-image-store.ts` | 保存先・命名・prune・`withPasteImageDir` がすべて `session-drops.ts` にある |
| クライアントの `savePastedImage` | `uploadDroppedFile(sessionId, file)` に置き換え |

統合で変わったこと:

- **保存先**は `~/.mulmoterminal/tmp/pasted/`（グローバル）から**セッションごとのドロップ用ディレクトリ**へ。
  セッション単位で隔離される分こちらの方が良く、`--add-dir` の付与も #1055 が既に行っている
- **転送**が JSON + base64 から**生バイト**へ。base64 の 33% 膨張が無くなる
- **ファイル名の生成が不要**になった。クリップボードの画像はファイル名を持たないが、
  `dropExtension(null, mime)` が content-type から拡張子を決める（`image/png` → `.png` を実測で確認）
- **サイズ上限・保持ポリシー・タイムアウト**が 1 か所になった

上の「MulmoClaude との違い」の議論はそのまま有効 — `POST /api/attachments` の管理された添付ストアには
寄せない、という判断は変わらない。変わったのは、こちら側で**2 つ目の使い捨てストアを作る必要が無かった**こと。

`common/pastedImageTypes.ts` は残る。サーバはどんなバイトでも受けるので、これは**クライアントが
「この paste を xterm から奪ってよいか」を決めるためだけ**の表になった。

---

## 実機のブラウザで確認した（capture フェーズの順序と、そこで見つかった 1 件）

「capture フェーズが xterm の paste ハンドラより先に走るか」は spec では固定できない。Chromium を
Playwright で起動し、**本物のクリップボードに PNG を書いて Cmd+V を押す**形で確かめた。真偽の根拠は
xterm の DOM ではなく `tmux capture-pane` と保存先ディレクトリ — PTY に届いたバイトが問いなので。

| 確認したこと | 結果 |
| --- | --- |
| 画像だけのクリップボード → Cmd+V | 絶対パスが PTY に届く（横取りが xterm より先に走る） |
| 届いたパスの実体 | 保存先に 1 件、`PNG image data, 64 x 64`、名前が pane にも出る |
| 送信されていないこと | pane にコマンド実行の痕跡なし |
| テキストだけのクリップボード | 従来どおり xterm に届く |
| 画像 + `text/plain`（ページからのコピー） | **テキスト**が入り、パスは増えない |
| 2 枚目を続けて貼る | 2 件目も保存され、両方のパスが入る |

最後の行で見つかったのが**区切り**の問題。挿入は cursor 位置に入るだけなので、末尾に何も付かないと
2 回目が `path1path2` になる — どちらのファイルも指さない 1 語。ドロップも同じコード
（`toInsertText`）を通るので、**共通側に末尾スペースを足した**。空配列は今までどおり `""` を返す
必要がある（`onDrop` が真偽でアップロードへの分岐を決めており、空白 1 文字はそれを潰す）。
