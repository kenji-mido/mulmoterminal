# feat: ドキュメントをエージェント抜きで Canvas に開く (#1374) — 第1段

issue #1374 の**実装順 1**（`presentDocument` + `presentHtml`）。`presentMulmoScript` は第2段。

決定事項は issue 本文に確定済み。ここには**実装の形**だけ書く。

## 仕組み — 既にあるものを繋ぐだけ

collection が同じことを既にやっている（`src/composables/seedCollectionCanvas.ts`）。

```
Files ペインの Canvas ボタン
  → 合成カードを作る            （ツールごとのデータ契約）
  → POST /api/agent/toolResult  （collection と同じ口。永続化される＝決定 3）
  → openCanvasFor(uid)          （拡大 + ペインを開く。TerminalGrid に既存）
  → View が docPath / filePath から self-fetch
```

新規のサーバコードは無い。

## ツールごとの契約 — プラグイン自身の関数を使う

自前で拡張子を判定しない（CLAUDE.md: 既存のユーティリティを使う）。

| ツール | 受け入れ判定 | カードの data |
| --- | --- | --- |
| `presentDocument` | `isDocumentPath(path)` | `{ markdown: "", docPath: path }` |
| `presentHtml` | `isPresentableHtmlPath(path)` | `{ filePath: path, previewUrl }` |

`markdown: ""` は `MarkdownToolData` が必須にしているため。`documentPathOf` は `docPath` を authoritative に読むので、空の `markdown` が「1行の本文」と誤解されることはない。

**`previewUrl` はホストが入れる。** 型のコメントいわく *"The HOST injects this (it knows how it serves `artifacts/html/…`)"*。View の fallback に頼らず明示する:

- artifacts 配下（`isHtmlArtifactPath`）→ `htmlArtifactPreviewUrl(path)`
- それ以外 → `htmlFileUrl(path)`（`/htmlfile/<scope>/…`、`server/backends/html.ts` が同じ CSP で配信済み）

後者が要るのは、**Files ペインはセルの cwd に根を張る**ので、ユーザーが開く html はたいてい artifacts の外にあるから。View の fallback（`/artifacts/html/…` の導出）だけだと iframe が壊れる。

## 実装

| ファイル | 内容 |
| --- | --- |
| `src/composables/canvasOpenFile.ts`（新規） | `canvasCardForFile(path)` — 純粋。開けるなら `{ toolName, data }`、無理なら null。`seedCanvasCard(sessionId, card)` — POST |
| `src/components/FilesPane.vue` | ツールバーに **Canvas** ボタン（Preview/Edit の隣）。`open-in-canvas` を emit |
| `src/components/TerminalGrid.vue` | emit を受けて seed → `openCanvasFor`。`canvasAvailable` に「結果履歴があるか」を足す（決定 2） |

**関数を prop で渡さず emit にする**（CLAUDE.md）。ボタンの表示可否は prop で親が決める — `FilesPane` は `FilesOverlay`（セル外の全画面 Files）にもマウントされ、そこには開く先のセルが無いため。

## 決定 2 の実装

`canvasAvailable` は拡大のたびに `/api/tools?sessionId=` を引いている。そこに `/api/agent/toolResults/<id>` の結果有無を足す。件数専用の口が無いので全件返るのは承知の上（issue に記録済み）。

これが無いと「seed 直後は開けるが、閉じると開き直せない」という穴が残る。

## 検証

- `canvasCardForFile` の単体テスト（md / html / 非対応 / artifacts 内外の previewUrl / 危険なパス）
- **ガードを外すと落ちること**を確認する（判定をプラグイン関数に委ねている以上、そこを迂回していないかが要点）
- Files ペインのボタンが、開けるファイルのときだけ出ること
- `yarn lint` / `typecheck` / `build` / `test`
- 実ブラウザで md と html を 1 つずつ開いて確認（スクリーンショットを残す）
