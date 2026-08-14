# fix(push): finished 通知が前のターンの応答を載せる (#1650)

## 症状

スマホの `finished` push のバナー本文が、そのターンの応答ではなく **ひとつ前のターンの応答**
になることがある。端末（PC / スマホ）のターミナル表示自体は正しい。サブエージェント
（Task ツール）を多用するワークフローで頻繁に起きる。

## 原因

`server/session/last-turn.ts` の `lastTurnFromClaudeParsed` は「**最後に完成した交換**」を返す。
これは handoff（`/api/transcript/last-turn`）が欲しい答えで、ターンが進行中なら前の交換に
フォールバックするのは意図的な設計（#254 / #1487）。

push はそれを流用しているが、push が欲しいのは「**いま終わったターンが何を出したか**」で、
両者は「ターンが応答を出さずに終わったとき」に食い違う。中断（ESC）や、ツール呼び出しだけで
終わったターンには応答が無いのに `Stop` は飛ぶので、パーサは**前のターンの応答を返し**、
それが「✅ 完了」の本文として送られる。

`session-reads.ts` の `readLatestResponse` は既にこの不変条件を明文化していた
（"a push must never describe a finished turn with the PREVIOUS turn's text — for that caller,
null has to stay null"）が、`sessionLastTurn` 経由の経路がそれを破っていた。

### 実データでの確認

このマシンの実トランスクリプト 11,489 本・ターン境界 13,200 箇所で計測:

- ターン全体がディスクにある状態でも、**193 箇所で古いターンの応答を返す**（応答を出さずに
  終わったターン）
- 読みが最終レコードより 1 レコード早いと、**1,629 箇所で古いターンの応答を返す**（null では
  なく古い本文を返すので、呼び出し側が誤りを検出できない）

Stop フックを実際に仕掛けた計測では、通常ターンでは Stop 発火時点で最終レコードはディスク上に
あった（Claude Code の書き込み順序自体は問題ない）。一方 `SubagentStop` は **メインの
トランスクリプトのパスで、メインターンが `tool_use` 途中の状態**で発火する（Stop の約 3 秒前）。
現状 `hook-settings.ts` は SubagentStop を登録しておらず `pushKindFor` も `Stop` だけなので
この経路は通らないが、登録すれば即座に同じ症状になる。

## 方針

`lastTurnFromClaudeParsed`（handoff の意味論）は変えない。push 用に**ターンスコープの読み**を
足す。

1. `last-turn.ts` に `currentTurnReplyFromClaudeParsed` を追加 — ユーザプロンプトを見たら
   それまでの応答を捨て、最新プロンプトより後の `endsTurn` な散文だけを返す。無ければ null。
2. `session-reads.ts` に `claudeCurrentTurnReply(cwd, id)` を追加。
3. `task-push.ts` の `latestReply` は claude のときだけこれを使う。

codex はそのまま `sessionLastTurn` を使う: `codex-activity-track` が「ターンが終わった」と
判断する根拠のレコード（`task_complete`）が応答そのものを持っているので、トリガが自分の
データを追い越せない。

応答が読めなければ `buildPushDetail` の既存フォールバック（lastPrompt → aiTitle →
「タスクが完了しました」）に落ちる。**古い応答を確信をもって出すより黙るほうが安全**、という
方向に倒す。

## 検証

- 旧実装と新実装を実データ 11,489 本・13,200 境界で並走させて比較:
  - ターン全体がある状態: 一致 13,007 / **旧が正しくて新が黙った件数 0** / 旧が古いターンを
    返していた 193
  - 1 レコード早い読み: 一致 11,551 / 旧が古い応答を載せた 1,629 / 新は黙った 1,649
- 比較スクリプトは検証後に削除（挙動の担保はユニットテスト側に置く）。
- `test/server/session/last-turn.spec.ts` に `currentTurnReplyFromClaudeParsed` の
  describe を追加（進行中・応答なしで終了・preamble・slash コマンドラッパ・空）。

## 影響

中断されたターンの push は、前のターンの応答ではなく「タスクが完了しました」（または
最後のプロンプト / AI タイトル）になる。バナーの情報量は減るが、間違ったターンの結果を
伝えることはなくなる。
