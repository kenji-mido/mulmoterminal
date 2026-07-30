# refactor: code scanning の jscpd 重複を減らす

`duplication-scan` (jscpd 5.0.12) が Code Scanning に上げていた `jscpd/duplicate-code` の
open アラート 9 件を対象に、**まとめて意味のあるものだけ**を潰す。

再現はローカルで CI と同じ引数を使う:

```
jscpd . --format "typescript,vue" \
  --ignore "**/node_modules/**,**/dist/**,**/*.d.ts,**/*.spec.ts" \
  --reporters console,json --output report
```

SARIF / API のアラートは**片側の位置しか持たない**ので、対になっている相手を知るには
ローカルで JSON レポータを回すしかない。

## 結果: 9 clone → 2 clone

| 対象 | 判断 |
|---|---|
| `ws-routes.ts` launch / codex / antigravity の前処理 ×2 clone | 直した |
| `GuiPanel` ↔ `ToolsPane` の tool-groups 再購読 | 直した |
| `CommandCell` / `LauncherCell` / `TerminalCell` の `CellChromeButtons` 配線 ×3 clone | 直した |
| `TerminalGrid` のセル振り分け ×1 clone | 直した |
| `CommandCell` ↔ `LauncherCell` のセル枠・ヘッダ | **残した**（下記） |
| `SessionTabBar` ↔ `Sidebar` の script 前置き | **減らせない**（下記） |

## 直したもの

**1. `announceSession` / `clientStillConnected` (`server/routes/ws-routes.ts`)**
launch / codex / antigravity の 3 ハンドラが「セッションを通知 → early frame を溜め始める →
設定ファイルを読む → 読み終わってからクライアントがまだ居るか確認」という同じ 4 手を書いていた。
元コードのコメント自体が "same guard as the claude path" と言っていて、ズレが実バグになる箇所。
`mcpGroups` の条件は 3 者で**本当に違う**（codex は `!attachGuiMcp && !live`、他は `live`）ので
そこは各呼び出し側に残した。

**2. `onToolGroupsAnnounced` (`src/composables/useToolGroupsAnnounce.ts`)**
`GuiPanel` / `ToolsPane` / `TerminalGrid` の 3 か所が同じチャネルを同じ理由で購読していた
（ToolsPane のコメントが "all three asked once at mount, and all three were asking too early" と
明言している）。副産物として **`data as { sessionId?: string }` の `as` を 3 か所で除去**し、
`isRecord` を使った型ガードに寄せた（CLAUDE.md: `as` 禁止）。
`groups` の有無は意味が違う（無い = 「MCP client が上がった」だけの通知で、空リストではない）ので
そこは型で表現し、パース側 1 か所に閉じた。

**3. `cellChromeBinding` (`src/components/cellChromeBinding.ts`)**
`CellChromeButtons` への 4 props + 5 emit の素通しが 4 か所（TerminalCell は 2 回）にあった。
`v-bind` / `v-on` のオブジェクト束縛 1 行に置換。`close` だけは TerminalCell が確認を挟むので
引数にした（#826）。

**4. `gridCellProps` / `gridCellEvents` (`src/components/TerminalGrid.vue`)**
`GridCellProps` / `GridCellEmits` は既に型としては共通契約なのに、テンプレートがそれを
セル種別ごとに 3 回書き直していた。共通分だけオブジェクト束縛にし、種別固有のもの
（`uid` / `command` / `launcher` / `initial-*`）と `@session`（CommandCell は emit しないので
渡すと Vue が warn する）は各所に残した。

## 残した / 減らせないもの

**`SessionTabBar` ↔ `Sidebar` (alert 102) — 減らせない。**
重複しているのは `defineProps` / `defineEmits` を書いている前置きそのもの。これは
**コンパイラマクロで、各 `<script setup>` に literal で無いといけない**（変数にも関数にも出せない）。
共有できるロジックは既に `composables/sessionList` の `SessionListProps` /
`SessionListEmits` / `useSessionFilter` に出ている。jscpd が見ているのは移動できない残りかす。

**`CommandCell` ↔ `LauncherCell` のセル枠・ヘッダ (alert 116) — 今回は残した。**
`<div class="cell">` → `CELL_INNER` → `cell-header` → `cell-dot` / `cell-dir` の足場が共通。
共有コンポーネント化はできるが DOM 構造そのものを動かす変更で、`.cell-header` /
`.cell-dot` を選ぶ spec と CSS、それに **fragment root だと scoped CSS が当たらない罠**（#787）に
触る。今回の他の変更と違って挙動が変わりうるので、独立した PR で扱うべき。

## 検証

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn typecheck:server` / `yarn typecheck:test` /
  `yarn build` すべて緑。`yarn test` 6495 passed。
- **`v-on` のオブジェクト束縛が本当に効くかを実測**した。`exactOptionalPropertyTypes` の
  型エラーが期待 props に `readonly "onToggle-expand"?: () => any` を出したので、kebab のキーが
  Vue の解決する形だと**コンパイラに確認**できた（記憶に頼らない）。
  なお Vue は kebab と camel の**両方**を解決するので、キーの綴りを片方に固定するテストは書けない
  — 書けるのは「5 つとも親に届く」ことなので、それを assert している。
- そのテストが**落ちることも確認**した（`toggle-canvasX` に壊すと該当 test だけ fail）。
  壊れないテストを足しても意味がないので。
- `toggle-canvas` / `toggle-tools` はセル単位のカバレッジが**元々ゼロ**だったので追加した。
- 実ブラウザでも確認: 2 セル起動 → 拡大 → files / tools ペーン開閉 → 復元 → close でセルが減る。
  **console の warning / error はゼロ**（`v-on` のキーを間違えると
  "Extraneous non-emits event listeners" が出るので、これが出ないこと自体が根拠になる）。
