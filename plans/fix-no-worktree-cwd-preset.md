# worktree を WORKING DIRECTORY のチップとして記憶しない

issue: #1542

## 問題

launch form の **WORKING DIRECTORY** のチップ列に managed worktree が溜まっていく
（`orion (uifix)` / `orion (eslint)` / `mulmoclaude3 (test)` …）。

困る理由は 3 つ:

- **worktree は使い捨て** — 1 タスク 1 ブランチの隔離用ディレクトリで、「またここで起動したい場所」
  ではない。
- **消えても残る** — worktree を削除してもチップは消えない（`remove-preset` はチップの × ボタン
  だけ）。実体のないパスを指すチップが積み上がる。
- 本来の「よく使うプロジェクト」が押し出されて見つけにくくなる。

## 記録経路は 2 つある

片方だけ塞いでも直りきらないので、両方に同じルールを効かせる。

| 経路 | いつ | どこ |
|---|---|---|
| セル起動時の自動記録 | セルが起動するたび、サーバ確定 cwd を記録 | `recordPreset()` — `src/composables/useAppConfig.ts` |
| `mulmoterminal init` の seed | init 実行時、Claude の履歴の cwd からリストを作り直す | `deriveCwdPresets()` — `server/config/cwd-presets.ts` |

`presetLabel()` には worktree 専用の分岐（`repo (task)` 表記）まであり、記憶することが前提の作りに
なっていた。

## 直し方

判定を **`common/worktreePath.ts`** に置き、両サイドから使う。

- `worktreeLabel()` を `src/components/cwdDisplay.ts` からここへ移動（呼び出しは 4 箇所）
- `isManagedWorktreePath(cwd, worktreesRoot)` を同ファイルに追加

`common/` に置くのは CLAUDE.md の「両側が判断に使う値・ルールは `common/`、`server/` と `src/` に
ミラーしない」に従ったもの。

### root 起点にする（#1543 の Codex レビュー）

最初は `worktreeLabel()` と同じ「パスの形」だけで判定していたが、それだと
`…/worktrees/<name>-<8hex>/<task>` という形をした**他人のディレクトリ**まで managed 扱いになる。
ラベルを間違えるだけなら見た目の問題だが、ここでのコストは**実在する作業ディレクトリが黙って
ランチャーから消える**ことなので、それは許容できない。

サーバには既に正しい規則がある — `worktreeTask(cwd, root)`（`server/config/worktree-task.ts`）が
`isStrictlyWithin(<MULMOTERMINAL_HOME>/worktrees, cwd)` で判定している。同じ権威に合わせる:

- `isManagedWorktreePath(cwd, worktreesRoot)` は **root 配下かどうか**で判定する（形だけでは判定
  しない）。root から 2 階層以上下、**かつ先頭セグメントが `<repo>-<8hex>`**（= このアプリが
  生成した名前）であることを要求する。root 直下に人が手で置いた hash なしのディレクトリは
  我々のものではないので掴まない。
- サーバは `worktreesRootDir()` をそのまま渡す。
- ブラウザは root を知らない（`MULMOTERMINAL_HOME` で移動できる）ので、`GET /api/config` が
  `home` と並べて `worktreesRoot` を返す。ランタイムの事実であって設定値ではないので、`home` と
  同じ扱い。
- **root が不明なときは `false`（= 記録する）**。間違え方は 2 通りあるが、「余計なチップが 1 つ
  出る（× で消せる）」ほうが「ディレクトリが黙って出てこない」より軽い。

### 初回 `/api/config` が返る前の launch（#1543 の Codex レビュー 3 回目）

上のフォールバックだけだと、初回 GET が飛んでいる最中の launch は root を知らないまま記録され、
ガードが素通りする。実際 `loadConfig does not clobber a preset recorded while the initial GET is in
flight (#164 review)` というテストが「その窓で launch が起きうる」ことを示している。

ただし**無条件に待たせると、その #164 の保証を壊す**（記録が GET の完了待ちになり、上のテストは
デッドロックする）。なので **形だけの事前判定**を挟む:

- `worktreeLabel(path) === null`（worktree の形ですらない）→ root が何であれ我々のものではないので
  **待たずに即記録**。#164 の保証はそのまま。
- 形が一致 かつ root 未知 かつ 初回 GET が飛行中 → その GET を待ってから判定。

待ちは `fetchWithTimeout` で上限が付いており、対象は worktree の形をしたパスだけなので通常の記録は
遅延しない。

**待つ場所は preset の書き込みロックを取る「前」**（4 回目の Codex レビュー）。`loadConfigOnce()` は
最後に `migrateLegacyRecents()` を await し、その migration は**同じ serializer** を要求する。ロックを
保持したまま config を待つと、record → config → migration → record の循環で**デッドロック**する。
legacy recents を持つアップグレードユーザーだけが踏む経路で、初回ロードが丸ごと固まる。回帰テストは
修正前のコードで 15 秒タイムアウトすることを確認済み。

包含判定は `common/dirPathKey.ts`（ブラウザ安全、`node:path` 不使用、両セパレータと `.`/`..` を
畳む）の上に組む。symlink と Windows の大文字小文字は畳めないが、root も cwd も同じサーバ由来なので
実運用では一致し、畳めない綴りは「ours ではない」= 安全側に倒れる。

`worktreeLabel()` のほうは**形だけの判定のまま**にした（セルヘッダの表示用で、間違えても
ラベルが変わるだけ・既存挙動）。2 つの関数がそれぞれ何を決めるかはコメントに書いた。

**読み出し時のフィルタではなく記録時のスキップにする。** 既に保存されているエントリはユーザーの
config なので、そこに勝手に手を入れない — 不要なら × ボタンで消してもらう。副作用として、既に
リストにある worktree は「先頭へ移動」もされなくなる（= 放置されるだけで、消えも増えもしない）。

## やらないこと（ユーザー確認済み）

- 既存 preset の自動掃除／マイグレーション
- `migrateLegacyRecents()`（pre-#163 の localStorage からの一度きりの取り込み）— 既存ユーザー
  データの取り込みなので「既存には触れない」と同じ扱い
- `presetLabel()` の worktree 分岐の削除 — 上の経路からはまだ到達しうる

## 変更ファイル

| ファイル | 内容 |
|---|---|
| `common/worktreePath.ts` | 新規。`worktreeLabel()`（移動・形だけ）+ `isManagedWorktreePath()`（root 起点） |
| `src/components/cwdDisplay.ts` | `worktreeLabel` / `MANAGED_DIR` を削除（表示整形だけを持つ） |
| `src/components/presets.ts`, `src/components/TerminalCell.vue` | import 先を `common/` に |
| `src/composables/useAppConfig.ts` | `recordPreset()` にガード |
| `server/config/cwd-presets.ts` | `deriveCwdPresets()` にガード（root は末尾の引数、既存呼び出しは不変） |
| `server/config/config-routes.ts` | `GET /api/config` が `home` と並べて `worktreesRoot` を返す |
| `test/common/worktreePath.spec.ts` | 新規。移動した `worktreeLabel` のテスト + 述語のテスト |
| `test/src/components/cwdDisplay.spec.ts` | `worktreeLabel` の describe を上へ移動 |
| `test/src/composables/useAppConfig.spec.ts` | 記録されない・リポジトリ本体は記録される・既存エントリを触らない |
| `test/server/config/cwd-presets.spec.ts` | init の seed でも worktree が落ちる |
| `README.md`, `docs/guide/{en,ja}/basics.md` | チップの説明に worktree 除外を追記 |
| `server/skills/mulmoterminal-dirs/SKILL.md` | `cwdPresets` を母集団として読む箇所に注記 |

## 検証

- `yarn format` / `yarn lint`（0 errors）/ `yarn typecheck`（exit 0）/ `yarn build`（exit 0）
- `yarn test` — **9267 passed** | 45 skipped
- 新しい spec が本当に型チェックされているか `tsc -b tsconfig.test.json --listFiles` で確認済み
  （`common/worktreePath.ts` と `test/common/worktreePath.spec.ts` の両方が対象に入っている）
