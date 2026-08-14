# refactor: code scanning の duplicate-code アラート 4 件を解消する (#1472)

`duplication-scan` (jscpd 5.0.12, minTokens=50 / minLines=5) の open アラートは 4 件。
SARIF は**片側の位置しか持たない**ので、対を知るには CI と同じ引数でローカル実行する
（前回 `plans/refactor-jscpd-duplication.md` と同じ手順）:

```
npx jscpd@5.0.12 . --format "typescript,vue" \
  --ignore "**/node_modules/**,**/dist/**,**/*.d.ts,**/*.spec.ts" --reporters console
```

| alert | 片側 | 対 | tokens |
| --- | --- | --- | --- |
| 142 | `server/config/dir-config.ts` 165-174 | `server/config/dir-icon.ts` 26-35 | 69 |
| 143 | `server/routes/ws-routes.ts` 635-643 | `server/routes/ws-routes.ts` 718-725 | 68 |
| 144 | `server/routes/ws-routes.ts` 689-697 | `server/routes/ws-routes.ts` 766-774 | 56 |
| 147 | `server/session/spawn-antigravity.ts` 37-69 | `server/session/spawn-grok.ts` 26-55 | 65 |

4 件とも原因は同じ: **後から足したものが、隣にあった同型のコードを写して増えた**。
icon は sound を、grok は antigravity を写している。写した側だけが直る drift が実バグなので、
写しではなく共有ヘルパにする。挙動は変えない。

## 1. cwd 配下へのファイル封じ込め (142)

`resolveDirSound`（音）と `resolveIconFile`（アイコン）が同じ 4 段の規則を各自持つ:
絶対パス拒否 → `path.resolve` → `isWithin` → 実在かつ通常ファイル → `realpathSync.native` で再チェック。
dir-icon.ts のコメント自身が "the same rule, and the same order of checks, as resolveDirSound"
と書いており、写しであることが明示されている。

→ `server/config/dir-file.ts` に `resolveFileWithinDir(cwd, ref): string | null` を出し、両方から呼ぶ。
mime 判定は icon 固有（拒否理由が違う）なので `resolveIconFile` 側に残す。

## 2. live pty / tmux の事実収集 (143)

`resolveCodexSession` / `resolveAntigravitySession` / `resolveGrokSession` / `resolveLaunchSession`
が同じ 3 行で始まり、前 3 つは `resolveReattachableId` + 同じ形の return で終わる。

→ ws-routes 内に `liveSessionFacts(requested)` と `resolveResumableSession(requested, resumeIdFor)`
を置き、4 箇所から使う。codex の `resumeRolloutId` は codex の語彙なので、共通側は
`resumeConversationId` で返し、codex の resolver だけが名前を付け替える。

## 3. antigravity / grok の WS ハンドラ (144)

この 2 つは「**MCP サーバをディレクトリの設定ファイルから読む**」同じ形のエージェント
（agy = `.agents/mcp_config.json`、grok = `.grok/config.toml`）。claude / codex と違って per-session の
`--mcp-config` が無く、`?gui=0` は dev terminal かどうかしか決めない。ハンドラ本体・`start*Entry`・
`*Start` interface まで同型なので 1 つにまとめる。

→ `handleDirectoryMcpAgentConnection(agent, deps, ws, req)` + `DirectoryMcpWsAgent` 記述子。
差分は記述子が持つ:

- `kind` / `label`（`TerminalWsKind` と失敗メッセージの表示名）
- `hydrated` — antigravity だけが持つ「session→conversation マップの読み込み待ち」。grok は
  on-disk マップを持たないので `null`。省略可にせず**必須**にして、理由をコメントで残す
  （5 番目のエージェントが黙って待たずに済ませるのを防ぐ）
- `resolveSession` / `spawn`

## 4. spawner (147)

`spawnAntigravityPty` と `spawnGrokPty` は、シグネチャ・`mcpGroups` の JSDoc・
「reattach になる spawn では共有 MCP ファイルを書かない」ガード・`ptySpawn` 周りが同型。

→ `server/session/spawn-directory-mcp.ts` に
`DirectoryMcpSpawnOptions`（`mcpGroups` + `initialPrompt`）と
`startDirectoryMcpPty(params)`（reattach ガード付き MCP 同期 → `ptySpawn` → 起動ログ → `ptys.set`）
を出す。antigravity 固有の「spawn 前スナップショット → conversation 捕捉」と
`wireAgentPtyRelay` は呼び出し側に残す。

## 検証

1. 上の jscpd コマンドで **clone 0 件**（抽出が中途半端だと 50 トークンを割らずに残るので、
   目視ではなく実際に回して確認する）
2. `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test`
3. 既存 spec が挙動の担保: `spawn-antigravity.spec.ts`, `spawn-antigravity-mcp-sync.spec.ts`,
   `spawn-grok-mcp-sync.spec.ts`, `ws-worktree-env.spec.ts`, `ws-unusable-cwd.spec.ts`。
   加えて共有ヘルパ自身の spec（封じ込め規則、reattach ガード）を足す。
