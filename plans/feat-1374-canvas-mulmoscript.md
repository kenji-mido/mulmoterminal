# feat: MulmoScript を Canvas に開く (#1374) — 第2段

issue #1374 の**実装順 2**。第1段（`presentDocument` + `presentHtml`、#1380）で入った
Files ペインの Canvas ボタンに `presentMulmoScript` を足す。

## 第1段と決定的に違う 2 点

第1段の md / html は「パスだけ載せた合成カードを書けば View が自己 fetch する」で済んだ。
mulmoScript は**どちらも成り立たない**。

### 1. 絶対パスが使えない

`normalizeStoryPath`（`@mulmoclaude/mulmoscript-plugin`）は **絶対パスとバックスラッシュを拒否**する。
受けるのは `stories/foo.json` / `foo.json` / `artifacts/stories/foo.json` の 3 つだけ。

第1段は「ペインはセルの cwd、プラグインはワークスペース」の食い違いを**絶対パスに結合して**
解決した（md / html のガードは絶対パスを受ける）。mulmoScript ではその手が使えないので、
**ワークスペース相対の `stories/<name>.json` を組み立てる**しかない。

つまりゲートは「拡張子が合うか」ではなく **「このファイルはワークスペースの
`artifacts/stories/` の中にあるか」** になる。プロジェクトセルが自分の `artifacts/stories/` を
持っていても、それはプラグインが開くファイルではないので**出してはいけない**。

ワークスペースは UI 側に既にある — `defaultCwd`（CLAUDE_CWD、`/api/config` 由来。
`launchChips` が WORKSPACE チップに使っているのと同じ値）。

比較は `common/dirPathKey.ts` の `dirPathKey` に載せる。セパレータ両方を畳み、`.` / `..` を
解決し、Windows のドライブルート / UNC を落とさない。**`..` が畳まれる結果、traversal は
プレフィックス照合に失敗して自然に落ちる**。

なおこの照合は**字句的**（ブラウザに symlink は解決できない）。第1段と同じく、
**間違ってもフェイルセーフ**である点が効く — 下の reopen がサーバ側で `normalizeStoryPath` と
realpath ガードを通すので、UI が通してもカードは書かれない。

### 2. カードにスクリプト本体が要る

`MulmoScriptData` は `{ script: MulmoScript; filePath: string }`。md の `docPath` や html の
`filePath` と違い、**`script` を欠いたカードは描けない**。

自前で読んで検証するのは、プラグインのロジックを二重化することになる（第1段で「判定は
プラグイン自身に委ねる」と決めた理由と同じ）。**既にある reopen 経路を呼ぶ**:

```
POST /api/plugin/presentMulmoScript  { filePath: "stories/x.json" }
  → 200 { data: { script, filePath }, message, instructions }   … 開ける
  → 200 { message: "... not found" }（data 無し）              … 開けない
```

失敗が **HTTP status ではなく 200 のフィールド**で返るのは、このルートの既存契約
（`server/backends/mulmoscript.spec.ts` が固定している）。`data` の有無で判断する。

`data.filePath` は正規化後の `stories/<name>.json` で、これは**エージェント自身のカードと
同じ値**。よって `filePathIdentity`（`src/utils/canvasIdentity.ts`）が両者を同じ artifact と
見なし、`collapseByIdentity` が畳む — 第1段と同じ挙動。

## API の形

`canvasCardForFile` は純粋関数のままでは足りない（reopen が要る）。分ける:

| 関数 | 役割 |
| --- | --- |
| `canOpenInCanvas(absPath, workspace)` | 純粋。ボタンの表示可否。3 ツール全部 |
| `buildCanvasCard(absPath, workspace)` | async。md / html は同期的に組み立て、mulmoScript だけ reopen する |
| `storyWirePath(absPath, workspace)` | 純粋。`stories/<rest>` か null |

`FilesPane` は `workspace` prop を受ける（grid が `defaultCwd` を渡す）。**ボタンとカードは
必ず同じ引数で同じ関数を呼ぶ** — 第1段でここが割れて「押しても何も起きないボタン」になった。

## 実装

| ファイル | 内容 |
| --- | --- |
| `src/composables/canvasOpenFile.ts` | `storyWirePath` / `reopenStory` を足し、`canOpenInCanvas` と `buildCanvasCard` に workspace を通す |
| `src/components/FilesPane.vue` | `workspace` prop、ゲートに渡す |
| `src/components/TerminalGrid.vue` | `:workspace="defaultCwd"`、`buildCanvasCard` を await |

## 検証

- `storyWirePath`: ワークスペース内 / プロジェクトセルの同名パス / traversal / `.json` 以外 /
  Windows セパレータ / ワークスペース未設定
- reopen: `data` あり → カード、`data` 無し（not found）→ null かつ POST しない
- ボタン: story ファイルで出る、ワークスペース外の同名パスでは出ない
- **各テストは対応する修正を外して落ちることを確認する**（第1段で無効なテストを 2 本作った）
- `yarn format` / `lint` / `typecheck` / `build` / `test`
- 実ブラウザで story を 1 つ開く
