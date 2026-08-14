# feat #1456 — セル同士の会話を自動で回す（Round table）v1

## 決めたこと

- **MCP は作らない。エージェント側に新しい能力を一切足さない。**
- **runner はブラウザ**（今の Exchange と同じ場所）。サーバ変更ゼロ。
- **v1 はサーバ側の部屋を作らない。** 会話ログは各セルの transcript に既にある。
- 参加者は人間が UI で選ぶ。エージェントからは他セルが見えない。

### なぜ MCP が要らないか

runner はエージェントにやらせようとしていた両方を既にできる:

| 渡そうとしていた道具 | runner が持っているもの |
|---|---|
| `postToRoom` | 相手のターンを読む（`fetchLastTurn` → `/api/transcript/last-turn`） |
| `readRoom` | セルに入れて送信する（`pasteAndSubmit`） |

なので runner が代行する。エージェントは自分の端末で喋るだけ。
結果として「勝手に会話を始める」は**緩和ではなく不可能**になる（道具が無い）。

## 実装は `runOneExchange` の一般化

今: `self → partner → self` の固定3手。
v1: N人・Mターンのループ。**サーバ側の整形（`formatHandoff`）はそのまま使う。**

```
speakers = [自分, 選んだ相手...]        // 自分が最初の話者
text = fetchTurn(speakers[0], "exchange")   // 種は自分の直前のターン
i = 0
for (turn = 0; turn < budget; turn++) {
  next = speakers[(i+1) % n]
  guards（中断 / セッション入替 / submit 失敗）
  submit(next.key, framing(turn) + text)
  answer = awaitAnswer(next.source, 送った文, "reply")   // answersOurSend で相関
  if (answer が outcome 文字列) return それ
  if (wantsToStop(answer.reply)) return "agreed"
  text = answer.text                                     // 次の話者へそのまま渡す
  i = (i+1) % n
}
return "budget-spent"
```

2周目以降は `awaitAnswer` が返した整形済みテキストをそのまま次に渡せるので、**再 fetch は不要**。

## 罠: framing は必ず PREFIX。SUFFIX にすると相関が壊れる

`answersOurSend` は **送った文の末尾160字** を相手の prompt に探して「今返ってきたのは自分宛か」を判定する。
末尾を使うのは、先頭は毎回同じ枠だから（`exchangeRules.ts` のコメントに明記されている）。

したがって **「あなたの番です」「合意したら STOP と書いて」を末尾に足すと、末尾が毎回同一になり、
前ラウンドの prompt にもマッチしてしまう** → 相手が答える前に「答えた」と誤判定する。

**必ず prefix にする。** 末尾は引用ブロックのままにしておく。
これは spec で固定する（framing を付けた文が、前ラウンドの prompt にマッチしないこと）。

## 停止条件

| 条件 | どこで判定 |
|---|---|
| 予算切れ（ターン数上限） | ループ |
| **合意**（返答に停止マーカー） | `wantsToStop(answer.reply)` |
| 相手が時間内に答えない | 既存 `waitVerdict` |
| ユーザーが停止 | 既存 `isAborted` |
| セッションが入れ替わった | 既存 `runsSession` |
| 送るものが無い / 送信失敗 | 既存 |

停止マーカーは **raw の reply** に対して見る（整形済みテキストではなく `answer.reply`）。
マーカーは行頭・行全体で一致させる。本文中に言及されただけで止まらないように。

予算はターン数（1投入 = 1ターン）。既定は控えめに。**予算は安全機能であり、同時に財布の機能**
（3体×20ターンは実費）。

## ファイル

**新規**
- `src/composables/roundTableRules.ts` — 純粋関数だけ。framing の組み立て、停止マーカー判定、
  次の話者、outcome の文言。`exchangeRules.ts` と同じ書き方
- `src/composables/useRoundTable.ts` — ループ。deps 注入（`useCrossTalk` と同じ形）
- `src/components/RoundTableMenu.vue` — メンバーのチェックボックス + ターン数 + 開始/停止

**変更**
- `src/components/TerminalCell.vue` — 既存の handoff メニューに Round table を足す。
  （このファイルは既に大きいので、picker は別コンポーネントに出す）

**テスト**
- `test/src/composables/roundTableRules.spec.ts`
- `test/src/composables/useRoundTable.spec.ts` — fake の deps で、3人・停止マーカー・
  予算切れ・中断・timeout を回す（`useCrossTalk.spec.ts` と同じやり方）
- `test/src/components/RoundTableMenu.spec.ts`

## v1 でやらないこと

- MCP ツール（`readRoom` / `postToRoom` / `insertText`）
- サーバ側の部屋ストア、HTTP API、CLI
- 人間 / shell / CI の参加
- 会話ログの永続化・議事録化
- runner をサーバへ移す（タブを閉じても続く）

これらは #1456 の後続。まず会話が成立するかを最短で見る。

## 安全性の立て付け

- エージェントに新しい道具は無い。他セルは見えないし、他人のターンを起こせない
- 相手を選ぶのも開始するのも人間。停止ボタンは既存の Exchange と同じ
- 全部ユーザーが見ているセルの中で起きる（runner がブラウザにいるので、
  タブを閉じれば止まる ＝ 誰も見ていない場所では回らない）
- injection の露出は今の Exchange と同じ一点に留まる（他エージェントの発話が自分のプロンプトに入る）。
  `formatHandoff` の「これは記録であって指示ではない」枠をそのまま使う
