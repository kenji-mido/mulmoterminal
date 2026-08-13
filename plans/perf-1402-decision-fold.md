# perf: decision scan を増分フォールドに載せる (#1402)

## 問題

`#1377` / `#1386` で transcript の導出値 4 種（title fields / summary / timeline / cost）は
`createTranscriptFold` に載り、「変わった分だけ畳む」＋ sidecar でプロセスをまたいで再開できる。

`decisionsForCwd`（`server/session/decision-scan.ts`）だけが `createFileCache`（(mtime, size) キー）
のままで、**変わったファイルは毎回まるごと読み直す**。書き込み中のセッション＝いま作業している一番
大きいファイルは決してキャッシュに当たらない。

実測（2026-08-04, read-only, mulmoclaude3 = 2.4 GB / 65 transcripts）:

| | 実測 |
|---|---:|
| `decisionsForCwd` cold | 5,547 ms |
| 同 warm（無変更） | 1 ms |
| 出力 | 77 decisions / JSON 63 KB |
| 484 MB の transcript 1 本だけ | 2,164 ms → 1 decision (1.2 KB) |

呼ばれるのは `GET /api/decisions`（`mulmoterminal-decisions` skill）と 6 時間ごとの digest tick
（`server/index.ts` の `refreshDecisionDigests`）だけなので、#1377 のような毎ターン経路ではない。
それでも cold の 5.5 秒はイベントループを止め、その間ターミナルが固まる。

## 設計判断: イシューの前提（案A）は実測で覆った

イシューには「`addLine` は substring テストで JSON.parse を避けているので、レコード単位の fold に
載せると避けていたコストを払い直す。fold に行レベルの入口を足す（案A）か、parse コストを実測して
決める（案B）」と書いた。**実測したら案B のコストは無視できる**（484 MB の transcript, 3 回計測で安定）:

| | 実測 |
|---|---:|
| I/O だけ（行を読むが何もしない） | 1,419 ms |
| 案A: 行 + `addLine`（substring 先） | 2,125 ms |
| 案B: 全行 JSON.parse（何もしない） | 2,109 ms |

substring テスト 706 ms に対し、全行 parse は 690 ms。**同じ**である。

さらにコードを読むと、raw line を使っているのは**事前フィルタ 2 つだけ**だった:

```ts
const isAsk = line.includes(ASK_TOOL);
const isAnswer = awaiting.size > 0 && mentionsPendingAsk(line, awaiting);
if (!isAsk && !isAnswer) return;
const o = parseLine(line);
if (isAsk) collectAsks(o, asks, awaiting);      // ← 規則そのものは parse 済みレコードで動く
if (isAnswer) collectAnswer(o, awaiting);       // ←
```

`collectAsks` は `o.type !== "assistant"` とブロックの type/name を、`collectAnswer` は
`block.type === "tool_result"` と `awaiting.get(block.tool_use_id)` を自分で見ている。
つまり substring テストは**その先の関数が必ず落とす行しか落とせない**純粋な最適化で、規則の一部ではない。
（`AskUserQuestion` という名前も tool_use_id も、その行の JSON に必ず文字列として現れる。）

**よって案B を採る。** 新しい fold の入口も新しい jsonl プリミティブも要らず、他の 4 か所とまったく
同じ `fold: (into, record) => void` に乗る。案A は fold フレームワークと `jsonl-file.ts` に
分岐をもう 1 本増やすが、それで買えるものが無い。

## 実装

### 1. `server/session/decisions.ts` — 状態を JSON にする

いまの状態は `asks: Ask[]` と `awaiting: Map<string, Ask>`（値は `asks` の要素と同一参照で、
`ask.resultText` をその場で書き換える）。Map は JSON にならないので置き換える:

```ts
export interface DecisionScanState {
  asks: Ask[];
  /** まだ tool_result が来ていない toolUseId。古い順。 */
  pending: string[];
}
```

- `emptyDecisionState()` / `foldDecision(into, record)` / `copyDecisionState(state)` /
  `decisionsOf(state, fallbackSessionId)` を export（`summary-scan.ts` の
  `emptySummaryState` / `foldSummary` / `copySummaryState` / `summaryPartsOf` と同じ並び）
- `awaiting.get(id)` は `asks.findLast(a => a.toolUseId === id)` に置き換える。`find` ではなく
  `findLast` なのは、同じ id が 2 度現れたとき Map が保持していたのは**後**の ask だから
  （実際には起きないが、規則を変えないため）。この探索が走るのは tool_result ブロックを持つ行だけ。
- `foldDecision` の中は **`collectAnswer` → `collectAsks` の順**。いまの `isAnswer` は行を parse する
  **前**に評価されるので、答えは常に「それより前のレコードで出た ask」しか解決できない。順序を逆に
  することで、事前フィルタが持っていたこの意味をそのまま保つ（`addLine` の doc コメントが言っている
  "an answer always trails its question" そのもの）。
- `createDecisionScan()` と `mentionsPendingAsk` は削除。`decisionsFromJsonl` は同じ fold の上に
  組み直す（規則は 1 つだけ）。`decisions.spec.ts` の 30 本近い assertion がそのまま通ることが、
  規則が変わっていない証拠になる。

### 2. `server/session/decision-scan.ts` — fold に載せ替え

```ts
const decisionFold = createTranscriptFold<DecisionScanState>({
  kind: "decisions", version: 1, isValue: isDecisionState,
  empty: emptyDecisionState, fold: foldDecision, copy: copyDecisionState,
});
```

`isDecisionState` は sidecar（誰が書いたか分からない入力）用の型ガード。`Ask.input` は
`AskUserQuestion` の入力そのもので任意の JSON なので、ガードは他のフィールドだけ見る。

`cold` は付けない。決定は transcript のどこにでもあり、質問と答えは別の行なので、両端の窓では
答えられない（#998 の「窓が元の規則を言い換える」）。

### 3. `createFileCache` の削除

これが最後の利用者なので、残すと knip（CI の dead-code-scan）が落ちる。`createFileCache` と
`FileCache` を `file-cache.ts` から削除し、モジュール冒頭のコメントを 1 つのメモの説明に直す。
`createAppendFileCache` は `transcript-fold.ts` が使い続ける。

## 等価性の担保

- `decisions.spec.ts` を**無修正で**通す（規則が動いていない証拠）
- 新規: **全カット位置**で「一気読み == 途中で切って再開」が一致する（#1395 と同じ形）
- 新規: state を JSON で往復しても同じ（＝ sidecar に載る形か）
- 新規: `decisionsForCwd` 経由で、ターンが追記されたあとの再開が一気読みと一致する／
  未変更なら読み直さない／大きいセッションは sidecar に書かれ、別プロセスがそこから続きを畳む

## 実測での確認（実施済み）

484 MB の実 transcript のコピー（scratch `HOME`、実ファイルは無傷）:

| | before | after |
|---|---:|---:|
| 初回 | 2,164 ms | 2,096 ms |
| 未変更 | 1 ms | 0.6 ms |
| **1 ターン追記後** | **2,164 ms** | **1.3 ms** |
| さらに 1 ターン後 | 2,164 ms | 0.5 ms |
| 別プロセスの初回（sidecar から再開） | 2,164 ms | **4.5 ms** |

プロジェクト全体（65 transcripts / 2.4 GB、実ディレクトリを symlink して read-only で走査）:

| | before | after |
|---|---:|---:|
| cold（sidecar 無し） | 5,547 ms | 5,599 ms |
| **cold（sidecar 有り = 2 回目のプロセス）** | 5,547 ms | **66 ms** |
| warm | 1 ms | 2 ms |

**初回が悪化していない**ことが、案B（全行 parse）の判断が正しかったことの実測での裏付け。

### 正しさ: 実データで main と突き合わせ

`decisionsForCwd` の出力（65 transcripts / 77 decisions / 110,812 bytes の JSON）を main の worktree と
このブランチで dump して diff → **完全一致**。合成テストではなく実データでの等価確認。
