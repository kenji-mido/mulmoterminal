# refactor: code scanning の重複コード 4 件を潰す（#1289）

jscpd が Code Scanning に上げている open alert 4 件（136 / 137 / 138 / 139）を 0 にする。
挙動は変えない。抽出した先にはテストを足し、最後に CI と同じオプションの jscpd で 0 件を確認する。

## 1. ws-routes: エージェント接続の前処理（alert 139）

`handleCodexConnection` と `handleAntigravityConnection` が、セッション解決の直後に同じ 4 行を
同じ順で書いている。claude / launch も同じ並びを持っており、実質 4 箇所の重複。

```ts
if (await refuseSecondWorktreeSession(ws, kind, cwd, { requested, sessionId })) return;
if (!attachGuiMcp) markDevTerminalSession(sessionId, effectiveSessionCwd(live?.cwd, cwd));
markAttachedSessionPlaced(sessionId, requested);
const early = announceSession(ws, sessionId, live?.cwd ?? cwd);
```

順序が壊れやすい部分（拒否は browser に id を伝える前でなければならない）なので、
`admitAgentSession()` として 1 関数にまとめ、`EarlyFrames | null` を返す。null は
「socket を閉じた、呼び出し元は return しろ」。

- `devTerminal` は「サイドバーに出さないグリッドのセルか」。claude / codex / antigravity は
  `!attachGuiMcp`、launch は常に true（launcher は常に dev terminal 扱い）。
- `worktreeLimited` は launch のためのフラグ。launcher は「codex を起動する launcher だけ」
  worktree の制限を受ける（`launcherRunsAgent`）。他は常に true。

## 2. モーダルのキーボード処理（alert 136）

Escape で閉じる / Tab をダイアログ内にトラップする、というハンドラが 4 コンポーネントにある
（`SettingsModal` / `ModelSetupHelp` / `CopyCodeBlock` / `TimelineOverlay`）。
listener の付け外しのタイミングだけが 4 者で違う（mount / 開いた瞬間 / watch）。

`src/composables/useModalKeyboard.ts` に 2 段で置く。

- `modalKeydown(modalEl, onClose, trapSelector?)` — ハンドラ本体だけ。付け外しは呼び出し元。
  `CopyCodeBlock`（textarea をフォーカス＆選択する独自の開き方）と `TimelineOverlay`
  （watch で open を見ている）はこちらを使う。
- `useModalKeyboard({ modalEl, onClose, focusSelector, trapSelector })` — mount で登録 ＋
  初期フォーカス、unmount で解除。`SettingsModal` と `ModelSetupHelp` はこちら。

## 3. 通知音の emit 宣言（alert 137）

`NotificationSoundsSection` が上げる 3 つの emit を、中継する `SettingsModal` が同じ形で
書き直している。`GridCellEmits` と同じやり方で共有の型に出す
（`src/components/settings/soundEmits.ts`）。props は片方が 13 個・片方が 3 個で形が違うので触らない。

## 4. handler queue（alert 138）

`useNewTerminal` と `useSpawnedChat` は「grid が mount していなければ queue し、register 時に
全件 drain し、stale な unregister は新しいハンドラを消さない」という同じ実装を持つ。
違いはハンドラの戻り値だけ（前者は void、後者は「grid が受け取ったか」の boolean）。

`src/composables/handlerQueue.ts` に `createHandlerQueue<Req, Ret>()` を置く。

- `register(h)` — 登録して queue を drain、unregister を返す
- `deliver(req, queuedResult)` — ハンドラがいれば呼んでその戻り値、いなければ queue して
  `queuedResult`（`useSpawnedChat` が「queue も grid 行きなので true」と決めている値）
- `reset()` — テスト用

各ファイルの「なぜ 1 枠ではなく全件持つのか」といった WHY コメントは、共有の仕組みの説明は
`handlerQueue.ts` へ、その seam 固有の話は元のファイルに残す。

## テスト

- `test/src/composables/modalKeyboard.spec.ts`（新規）— Escape / Tab / それ以外のキー / modalEl 無し
- `test/src/composables/handlerQueue.spec.ts`（新規）— drain 順、stale unregister、queue 後の空、戻り値
- 既存の `useNewTerminal.spec.ts` / `spawnedChat.spec.ts` / `test/server/routes/*` はそのまま通ること

## 検証

`yarn format` → `yarn lint` → `yarn typecheck` / `typecheck:server` / `typecheck:test` →
`yarn build` → `yarn test`、最後に CI と同じ引数の jscpd で `0 clones` を確認する。
