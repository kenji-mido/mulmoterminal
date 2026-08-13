# fix #1161 — Codex の数字が Claude のものに見える／プローブが「API キー課金」に貼り付く

## 報告

Claude と Codex を併用しているユーザーから「Codex の usage が反映されない」「Claude の 5 時間が
取れていない」「追加の設定が必要か」。実際の画面は `claude usage n/a | 7d 71%`。

## 調査で分かったこと

### その `7d 71%` は Codex のもの

`claudeProbeNote()` は Claude に表示できるウィンドウが 1 本も無いときだけ文言を返す。つまり
`claude usage n/a` が出ている時点で Claude 側は 0 本で、右隣の数字は Codex のものしかあり得ない。
`agentGauges()` / `claudeProbeNote()` を同じ入力で走らせて画面と同じ状態を再現済み。

現行の Codex はそもそも 5h を出さない（手元の実 rollout 全件で `primary.window_minutes: 10080`、
`secondary: null`）。上流仕様であり、`codex-rate-limits.ts` は window_minutes で正しく 7d に
振り分けている。直すものは無い。

### 実測: プローブ中の statusLine は 2 回発火する

Claude Code 2.1.220 に対して実 PTY でプローブを再現し、statusLine の発火ごとにペイロードを
保存して確認した。

| 発火 | `cost.total_api_duration_ms` | `rate_limits` |
| --- | --- | --- |
| 1 回目（API 応答前） | `0` | ABSENT |
| 2 回目（API 応答後） | `2769` | `five_hour` / `seven_day` あり |

`total_api_duration_ms` が「このセッションは既に API 応答を受けたか」を示す唯一の材料。
パーサ (`statusline.ts`) 自体は今も正しく動いている。

## 直すもの 1 — note が出ているときエージェント記号が消える

`agentGauges()` の `marked` は「両エージェントが数字を持つとき」だけ true。note が出ている状況では
Claude 側が 0 本なので必ず false になり、Codex の数字がラベル無しで note の右に並ぶ。

行に 2 つ以上のものが乗るかどうかが本来の判定基準なので、note の有無も同じ判定に入れる。
呼び出し側が note と記号を別々に決められる限り同じズレが再発するため、**1 つの関数が両方を返す**
形にして、`agentGauges` は非公開にする。

- `src/composables/rateLimitGauge.ts`: `rateLimitReadout(snapshot, now_ms) → { note, gauges }` を
  追加。`agentGauges` / `claudeProbeNote` は export をやめて内部に閉じる。
- `src/components/RateLimitGauge.vue`: 既存の 1 パス `view` computed をそのまま `rateLimitReadout`
  に置き換える。

## 直すもの 2 — API 応答前の statusLine を「答え」と解釈しない

`rate-limit-store.ts` の `report()` は窓の無い Claude statusLine を無条件で `no-windows`
（API キー課金）にし、`lastStatusLineAt_ms` も進める。プローブが完走しなかった場合これが最後の
状態として残り、

- ツールチップが誤った理由を出し続ける
- `noteProbeFailedIfNoReport()` が「答えた」と見なして失敗を数えない
- `retryDelayFor(no-windows)` = 1 時間に固定され、指数バックオフに乗らない

窓が無いことが意味を持つのは、そのセッションが既に API 応答を受けた後だけ。

- `server/agents/statusline.ts`: `hadApiResponse(payload)` と、それと窓をまとめて返す
  `readClaudeStatus(payload) → ClaudeStatus` を追加。
- `server/agents/rate-limit-store.ts`: `report(agent, ...)` を `reportCodex` /
  `reportClaudeStatus` に分ける。`agent === "claude"` の分岐が消え、Claude 用の判定を
  迂回する経路も無くなる。API 応答前の窓なし statusLine は状態も `lastStatusLineAt_ms` も動かさない
  ＝ プローブが黙って終われば正しく `no-report` の指数バックオフに乗る。
- `server/agents/rate-limit-routes.ts` / `server/index.ts`: 新しい入口に合わせる。

## テスト

- `test/src/composables/rateLimitGauge.spec.ts`: note が出ていて Codex に数字があるとき記号が
  描かれること。既存の `agentGauges` ケースは `rateLimitReadout` 経由に移す。
- `test/src/components/RateLimitGauge.spec.ts`: 画面に note と Codex ゲージが同時に出るとき、
  Codex の行が誰のものか分かること（描画側にも 1 本）。
- `server/agents/rate-limit-store.spec.ts`: API 応答前の窓なし statusLine が `no-windows` に
  ならず、その後のタイムアウトが `no-report` の失敗として数えられること。
- `server/agents/statusline.spec.ts`: `hadApiResponse` / `readClaudeStatus`。実測した 2 つの
  ペイロード形をそのまま使う。
