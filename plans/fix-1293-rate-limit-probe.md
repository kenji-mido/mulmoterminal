# fix #1293 — usage プローブを盲打ちから引数プロンプトへ

## 背景

ヘッダーの usage（Claude 5h/7d）が `claude usage n/a` や古い値のまま張り付く報告が、#1161 / #1162
（v2.9.1）の後も続いた。実 PTY で現行プローブと同じ手順を再現して計測した結果、原因は表示側ではなく
**プローブの入力方法**だった。

## 計測（Claude Code 2.1.220 / 実 PTY / statusLine の実 JSON）

| 条件 | 結果 |
|---|---|
| 現行と同じ手順（4.0s 待ち → タイプ → 0.8s 後 submit） | 8.0s で `rate_limits` 取得 |
| タイプ開始を 0.2s に早めただけ | **45s でもデータ無し**。画面は `❯ replywiththesinglecharacter:.`（空白が落ち、Enter も効かず未送信） |
| 到達不能な MCP サーバー 1 本 | 8.0s 成功（MCP 単体では止まらない） |
| 未認証 MCP（401 → OAuth 探索 → 動的登録）1 本 | 9.0〜15.0s 成功（起動は明確に遅くなる） |
| `--strict-mcp-config` | `/mcp` が 3 → 1（アカウント側コネクタが消える）。プローブは 11.0s で成功 |
| プロンプトを引数で渡しキー入力ゼロ | **5.0s で成功** |
| 未 trust ディレクトリで現行手順 | trust ダイアログの既定選択が Enter で確定され、`hasTrustDialogAccepted: true` が書かれる |

## 原因

固定タイミング（`BOOT_MS = 4000` → `TYPE_TO_SUBMIT_MS = 800`）で盲打ちし、**質問が送られたかを検証していない**。
TUI の入力受付が間に合わないと打鍵が捨てられ、API 応答が起きず `rate_limits` も来ない。90 秒でタイムアウトし、
`no-report` の指数バックオフ（最大 1 時間）に落ちるが、**リトライも同じ固定タイミング**なので自然回復しない。

起動を遅らせる要因は環境側にいくらでもある（MCP コネクタの OAuth 探索、プラグイン同期、大きなワークスペース）。
プローブはツールを一切使わないのに、ユーザーの MCP 設定を全部読み込んでいる。

## 変更

### 1. 質問を引数で渡す（`server/agents/rate-limit-probe.ts`）

`claude --session-id … --permission-mode auto --strict-mcp-config --settings F "<PROBE_PROMPT>"`。

- `BOOT_MS` / `TYPE_TO_SUBMIT_MS` / `write` の 2 段タイマーを削除
- `ProbeDeps.submitSequence` を削除（`index.ts` の配線も）。#1148 の esc-cr 問題はプローブでは構造的に消える
- trust ダイアログを黙って承認する副作用も消える（キーを一切送らないため）

### 2. `--strict-mcp-config`

プローブだけ MCP 設定（アカウント側コネクタ・プラグイン・`.mcp.json`）を読まない。通常セッションには無影響。

### 3. 古い読み取りを現在値として描かない

`rate-limit-store.ts` に `CLAUDE_READING_MAX_AGE_MS`（= 1 時間）を置き、`snapshotBody` が古い Claude の値を落とす。
バックオフの上限が 1 時間なので、それより古い＝失敗サイクルを丸 1 回以上跨いだ読み取り。値が落ちれば既存の
`claudeProbeNote()` が理由を出す（UI 側の判定は増やさない）。

Codex は据え置き。rollout ファイルの読み直しは無料で、「測れなかった」状態が存在しない。

### 4. 失敗理由を残す

- プローブが自分の PTY 出力を上限付き（末尾のみ）で保持する
- trust プロンプトは実測した文言で判定し、専用の note を出す（唯一、確実に案内できる原因）
- それ以外は末尾を `<MULMOTERMINAL_HOME>/probe-last-screen.txt` に保存し、console に 1 行だけ場所を出す

## テスト

- `rate-limit-probe.spec.ts`: 引数プロンプトになったこと、キーを一切送らないこと、`--strict-mcp-config` が付くこと
- 新規 `probe-stall.spec.ts`: 実画面から取った trust ダイアログ文言で分類できること／通常画面を誤判定しないこと
- `rate-limit-store.spec.ts`: 古い読み取りが落ちること、新しいものは残ること
- `rate-limit-routes.spec.ts`（あれば）: `claudeProbeStall` が載ること
