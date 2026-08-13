# feat(#1253): スマホから始めた issue 作業をそのまま実行する

## 何が止まっているか

スマホから issue の行をタップすると worktree が切られてセッションは立ち上がるが、issue 本文は
**入力欄に置かれるだけで走らない**。スマホには Enter が無いので、そこで止まる。

スマホ側だけでは直せない。理由は3つとも「ホストしか知らない事実」に依存している:

- 種プロンプトは `draft` として入る。`planDraftInjection` は draft を `autoSubmit: false` と決め打ちする
  （未レビューのテキストは絶対に自動送信しない、という設計上の規則）。
- `sendTerminalInput` は Enter だけを送れない。`sanitizeTerminalInput` 後に空なら throw する。
- 何か文字を送る回避策も駄目。`canClearInputBox` が貼り付け前に Ctrl-C で入力欄を消す。
- そもそも注入は TUI の準備完了マーカー待ちなので、外から撃つ Enter は注入と競合する。

## 直し方 — 既存の auto-run 経路に乗せるだけ

`initialPrompt` で spawn すれば、`attachDraftInjection` が入力欄の準備を待ってからペーストし、
`DRAFT_SUBMIT_MS` 後に**別チャンクで** submit まで送る。`startChat` が既に使っている経路で、
新しい仕掛けは要らない。draft と initialPrompt の違いは `planDraftInjection` の1行だけ。

```
run: true  → { cwd, initialPrompt: seed }   autoSubmit: true   タイプして Enter
run: false → { cwd, draft: seed }           autoSubmit: false  タイプするだけ（現行）
```

## `resumed` の除外は書かない — 構造で保証する

`run` を **spawn クロージャに閉じ込める**ので、`server/git/issue-work.ts` は無変更。

`startIssueWork` は `outcome: "resumed"` のとき `reopenIssueWorktree` の
`action === "resume"` で早期 return し、**`spawnDraft` を呼ばない**。呼ばれない以上 `run` は
届かない。「resumed のときは実行しない」を新しい条件分岐として書き足すと、同じ規則が2箇所に
できて片方だけ腐る。

同じ理由で、返り値の `ran` は `outcome` から導出せず**クロージャが呼ばれたかを観測**する。
将来 `outcome` が増えても嘘にならない。

## デスクトップは現行のまま

`server/routes/issue-work-routes.ts` は変更なし。issue を書いた人と走らせる人が違う、という
理由はデスクトップにはそのまま当てはまる。分岐はスマホ側の `run` だけが動かす。

## なぜ自動実行して安全か

`issueSeedPrompt` の最終行が
`Let's work on this issue. Read it through first and confirm the approach with me before implementing.`
なので、自動実行しても**実装の前に一度必ず止まって方針を確認する**。

## 変更するファイル

| ファイル | 変更 |
|---|---|
| `server/session/issue-spawn-options.ts` | 新規。`run` → spawn オプションの純関数 |
| `server/backends/remoteHost/handlers/deps.ts` | `spawnIssueDraft` → `spawnIssueSeed(cwd, seed, run)` |
| `server/backends/remoteHost/handlers/issueWork.ts` | `params.run` を読み、`ran` を返す |
| `server/backends/remoteHost/index.ts` | dep 名の付け替え |
| `server/index.ts` | `remoteHostSpawnIssueSeed` が純関数を使って spawn |
| `docs/remote-host-protocol.md` | params 表・outcome 表・理由 |

## なぜ純関数を1つ切るのか

`draft` と `initialPrompt` を**両方**渡すと `planDraftInjection` の `??` で draft が勝ち、
**エラーも警告も出ないまま走らない**。「必ず片方だけ」はテストで固定する価値がある不変条件で、
`server/index.ts` は単体テストできない場所なので、決定だけを純関数に出す。

## `run` が boolean でなかったら

`params.run === true`。boolean 以外は draft 扱い（現行動作）に落ちる。安全な側であり、
返り値の `ran` が実際どうなったかを正しく報告するので、スマホが「実行しました」と誤表示することは
起きない。

## テストで固定すること

- `run` を渡すと `initialPrompt` だけが立ち、`draft` は**立たない**（逆も同様）
- `attachGuiMcp: false` はどちらでも変わらない（worktree の作業セッションなので）
- スマホが `run: true` を送ると spawner の第3引数が `true` で呼ばれる
- `run` 無し / `run: false` / `run: "true"`（非 boolean）はいずれも `ran: false` で draft のまま
- `outcome: "resumed"` は `run: true` でも `ran: false`（spawner が呼ばれない）
- worktree-busy の拒否は `run` に関係なく従来どおり文面ごと伝わる

## やらないこと

- デスクトップ `POST /api/issues/start` の挙動変更
- `sendTerminalInput` で Enter を送れるようにすること（#1253 が退けた道）
- スマホ側（mulmoserver）の変更 — このオプションが入ったら `run: true` を足すだけ
