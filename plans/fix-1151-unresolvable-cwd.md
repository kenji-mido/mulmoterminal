# fix: 解決できない cwd を無言でデフォルトワークスペースに差し替えない (#1151)

`resolveWorkspace(cwd) = existingWorkspace(cwd) ?? CLAUDE_CWD` が、**明示的に渡された `?cwd=`**
まで黙ってデフォルトに差し替える。#1146（Windows の picker が CP932 で書いて日本語パスが化ける）
はこの増幅器のせいで「選んだフォルダで開かない」以外の手がかりが無い症状になった。エンコーディング
自体は #1150 で直っているが、増幅器は残っている。

## 決めたこと（ユーザー確認済み）

| 論点 | 決定 |
| --- | --- |
| 対象範囲 | **起動経路 + 読み取り系ルートの両方**。呼び出し元ごとにフォールバックの是非を判断する |
| 生きているセッションへの再接続 | **今のまま通す + ログ警告**。ディレクトリを移動しただけで実行中のエージェントから締め出さない |
| 絶対パスでない `?cwd=` | **同じく拒否**、専用の文言 |

## 3 つの結果を区別する

いま `resolveWorkspace` は 2 つの入力（「渡されていない」「渡されたが解決できない」）を 1 つの答え
（デフォルト）に潰している。ここを分ける:

```ts
export type WorkspaceRequest =
  | { kind: "default"; cwd: string }      // ?cwd= が無い → デフォルトが正しい答え
  | { kind: "resolved"; cwd: string }     // ?cwd= が実在するディレクトリを指した
  | { kind: "unusable"; requested: string; problem: string }; // 渡されたが使えない
```

`?cwd=` が**空文字**のときは「無い」と同じ（現状維持。`resolveWorkspace("")` は CLAUDE_CWD）。
文字列でない値（`?cwd=a&cwd=b` の配列など）は **unusable** にする — 渡されてはいるので、黙って
デフォルトにするのはこの issue が問題にしている挙動そのもの。

### 文言は #1078 のものを使い回す

`problem` は `server/infra/spawn-cwd.ts` の `cwdProblemMessage` から作る（`SpawnCwdError` が
出すのと同じ文）。「絶対パスでない」だけは spawn 側の概念ではない（子プロセスは相対パスを
自分の cwd から解決できる）ので workspace 側に置く。

## 起動経路（ws-routes）

`wsConnectionContext` が `resolveWorkspace` を通すせいで、`ptySpawn` の
`refuseUnusableCwd` / `SpawnCwdError`（#1078）は**この経路では絶対に発火しない**。届く前に
パスが差し替わっているため。

- **新規 spawn** で `unusable` → `closeWithError(problem)`。クライアントは既に
  `messageEffect` で赤い `[…]` バナーをセルに書き、terminal 扱いで再接続もしない。
  **新しい UI は要らない**。
- **再接続**（同一プロセスの live pty / 生存している tmux）で `unusable` → `console.warn` して
  従来どおりデフォルトへフォールバック。ここを拒否すると、ディレクトリを移動しただけで
  実行中のエージェントに戻れなくなる（`refuseUnusableCwd(cwd, reattached)` が同じ判断をしている）。
  なお生の壊れたパスを tmux クライアントの cwd に渡すと macOS では子プロセスが黙って exit 1 する
  ので、**フォールバックは再接続を守っている**。表示上の cwd は `effectiveSessionCwd` が
  live pty 側を優先するので変わらない。
- `/ws/run` は ephemeral（reattach が無い）ので常に拒否側。

## 読み取り系ルート

`workspaceFromQuery` を使っている 10 ルートは、解決できない `?cwd=` に対して**要求された
ディレクトリの名前で別のディレクトリの答え**を返している。実害の大きい順に:

| ルート | 何が起きるか |
| --- | --- |
| `/api/scripts` | 返した `cwd` でセルがスクリプトを**実行する** |
| `/api/sessions` | 返した `cwd` でセルがセッションを**resume する** |
| `/api/session/:id`・`/api/transcript/*`・timeline | 別プロジェクトの transcript を読む |
| `/api/dir-config`・`/api/dir-sound` | 別ディレクトリの色・音を着る |
| `/api/git-status`・`/api/pr-phase`・`/api/header`・`/api/skills`・`/api/cost` | 別ディレクトリの答え |

いずれも `unusable` なら答えない: **404 + `{ error: problem }`**（絶対パスでない等の壊れた要求は
400）。クライアント側は既に「取れなければ空」を実装しているので追加の分岐は不要
（`useDirLists` は !ok を空リスト、`useDirConfig` は EMPTY、`fetchSessionDetail` は null）。

200 + 空ペイロードにしない理由: それは「ここには何も設定されていない」と見分けが付かず、この
issue が問題にしている沈黙そのものになる。404 なら理由が body とログに残る。

### 触らないもの

`/api/dir-config-detail` と `/api/gui-mcp-groups` は既に `existingWorkspaceFromQuery` で
フォールバックしない（200 + 空ペイロードを返す）。**この issue の要件は既に満たしている**ので、
クライアント契約を変えてまで 404 に揃えることはしない。差分を最小にする方を採る。

## テスト

- `workspace.spec` — 3 つの結果、空文字と非文字列の扱い、文言
- ws — 新規 spawn は `closeWithError` で拒否 / 再接続は警告して通す / `/ws/run` は拒否
- 読み取り系 — supertest で 404 + 理由、`?cwd=` 無しは従来どおりデフォルト

## 実測（本物のサーバーに対して）

spec が緑なのは「自分の書いたものどうしが一致した」だけなので、`PORT=7719 yarn server` で
**実際のサーバーを起動して** HTTP と WebSocket を直接叩いた。

| 条件 | 結果 |
| --- | --- |
| `GET /api/scripts`（cwd 無し） | 200 / `cwd` = デフォルトワークスペース |
| `GET /api/scripts?cwd=/tmp` | 200 / `cwd` = `/tmp` |
| `GET /api/scripts?cwd=<消したディレクトリ>` | **404** + 理由（"no longer exists …"） |
| `/ws?cwd=<消したディレクトリ>` | **error フレーム**（同じ文言） |
| `/ws?cwd=relative/path` | **error フレーム**（"is not an absolute path"） |
| `/ws/run?cwd=<消したディレクトリ>` | **error フレーム** |
| `/ws/launch?shell=1&cwd=<消したディレクトリ>` | **error フレーム** |
| `/ws/launch?shell=1&cwd=/tmp` | **session フレーム**（普通の起動は壊れていない） |
| 生きているセッションへ `?session=<id>&cwd=<消したディレクトリ>` | **attach 成功**。しかも返る cwd は実際の `/tmp`（`effectiveSessionCwd`） |
| 存在しない session id + 同じ cwd | **error フレーム**（reattach の抜け道になっていない） |

サーバーログにも `[ws/claude] refusing to start — …` と
`[ws/launch] attaching <id> despite an unusable ?cwd= — …` が出ることを確認。

## 検証

`yarn format` → `yarn lint` → `yarn typecheck` → `yarn typecheck:server` → `yarn typecheck:test` →
`yarn build` → `yarn test`。
