# fix: codex の rollout id を永続化する（#1418）

## 症状

サーバを再起動し、かつ tmux セッションも生きていない状態（マシン再起動 / `tmux kill-server` /
codex 内で `/exit` 済み）で grid セルを開くと、その codex 会話に戻れず真っさらな codex が起動する。

## 原因

`codexRolloutIds`（`registry.ts`）がプロセスメモリだけ。消えると `resolveCodexSession` は
`mappedId = null`、`conversationExists()` も false（key は MulmoTerminal 採番の UUID で
rollout id ではない）となり、`canResume: false` → fresh spawn。

## 方針 — agy 側（#1157）の形をそのまま使う

read 側の判定 `agentResumeId()` は **すでに codex と agy の共用**として書かれている
（「the problem is the same for both, and so is the answer」）。書き込み側も同じ形にする。

### 共通モジュールに抜き出す（コピーを増やさない）

`server/session/antigravity-conversations.ts` の中身は、codex に必要なものと
**フィールド名以外まったく同一**（`{ sessionId, <agent の id>, cwd, startedAt }`）。
コピーを1本増やすと jscpd の対象になり、フォーマットの直し場所が2箇所になる。

→ `server/session/agent-conversations.ts` に一般化し、agy と codex の両方が使う。

- 型は `AgentConversation { sessionId, conversationId, cwd, startedAt }`
- **agy のディスク上のフォーマットは1バイトも変えない**。ファイル名
  `antigravity-conversations.jsonl`、フィールド名 `conversationId` を維持する
  （2.9.0 以降のユーザーが既にこのファイルを持っている）
- codex は `codex-rollouts.jsonl` に、**同じフィールド名で** rollout id を入れる。
  「codex の rollout id」と「agy の conversation id」は `agent-resume.ts` が既に同一概念として
  扱っているので、1つのフォーマットにする

### registry.ts をファクトリ化

agy 用に手書きされている「map + writtenIds + hydrated promise + persist チェーン + remember」を
`conversationLog(file, label)` に畳み、agy と codex の2本を作る。agy 側の意味論
（`startedAt` の引き継ぎ、重複時の早期 return、`writtenIds` の追加順）はそのまま保つ。

## 変更点

| ファイル | 変更 |
|---|---|
| `server/session/agent-conversations.ts` | 新規（`antigravity-conversations.ts` を一般化）|
| `server/session/antigravity-conversations.ts` | 削除 |
| `server/session/registry.ts` | `conversationLog()` ファクトリ。`codexRolloutIds` を廃し `codexRollouts` / `codexRolloutsHydrated` / `rememberCodexRollout` を追加 |
| `server/session/spawn-codex.ts` | ローカル関数 `rememberCodexRollout` を `captureCodexRollout` に改名（agy の `captureAntigravityConversation` に合わせる）。発見時と resume 時の両方で registry の `rememberCodexRollout(sessionId, rolloutId, cwd)` を呼ぶ |
| `server/routes/ws-routes.ts` | `resolveCodexSession` が `codexRollouts` を読む。`handleCodexConnection` で resolve の**前に** `await codexRolloutsHydrated` |
| `server/session/session-reads.ts` | `codexLastTurn` が `codexRollouts` を読む。ここでも hydration を待つ |

## なぜ hydration を resolve の前に待つのか

agy 側のコメントがそのまま当てはまる。ログはディスクにあるので、読み込み中に届いた再接続は
空の map を見て「resume できない」と判断してしまう — それはまさにこの機能が存在する再起動時の
ケースそのもの。

## テスト

- `test/server/session/antigravity-conversations.spec.ts` → `agent-conversations.spec.ts` に改名し
  import を追従。既存の全ケース（行フォーマット、空白入り cwd、last-line-wins、壊れた行、
  hydration が live レコードを上書きしない、`agentResumeId` との合成）を維持
- codex 側を追加: 同じログ形式で rollout id が round-trip すること、hydrate した map が
  `agentResumeId` の `mappedId` になって cold resume が成立すること、ログが空なら
  「間違った会話を開く」のではなく resume を諦めること

## やらないこと

- `claimedCodexRollouts` / `claimedAntigravityConversations` の永続化。これはプロセス内で
  1つの rollout を2セッションが取り合わないためのもので、再起動をまたぐ意味は無い
- codex の会話一覧 UI（#1417）
