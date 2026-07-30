# feat: 定期データ同期のセッションを Background フィルタに分ける (#1060)

## 決めたこと

issue #1060 は「バックグラウンドのデータ同期セッションを履歴から**丸ごと落とす**」（MulmoClaude の
`origin: "system"` と同じ扱い）を提案していた。採らない。代わりに **MulmoClaude の履歴フィルタと同じく、
チップで絞り込めるようにする**。

- `All` = 人が始めたチャットのみ（バックグラウンドは既定で出ない）
- `Background` = バックグラウンドのワーカーだけ
- `Unread` は現状のまま（`isUnread` は元々 hidden を除外している）

なぜ「消す」ではなく「フィルタ」か:

MulmoTerminal のセッションは**チャット記録ではなく生きた端末**で、消すと開けなくなる＝止める手段も失う。
チップの裏に置けば、既定の画面からは消えつつ、開いて中を見ることも止めることもできる。issue が挙げていた
反対論（勘所4 の「間違えても正しく見える」を除く）はこれで解消する。

## 現状の落とし穴 — フィルタ案でも永続化は要る

`hiddenSessions`（`server/session/registry.ts`）は**メモリのみ**で、しかも
`server/session/lifecycle.ts` の reap で削除される。つまりワイヤに乗る `hidden` フラグは
**ワーカーが終わった瞬間／サーバ再起動で外れ、普通のチャットとして一覧に戻る**。

フィルタにしても「除外したいものが除外されない」ので、`devTerminalSessions` と同じ
**append ログによる永続セット**が必要になる。ここは issue の勘所1 と同じ。

## 実装

### サーバ

1. **`server/session/dev-terminal-sessions.ts` → `server/session/session-id-log.ts`**
   中身は「id を 1 行 1 個で追記するログ」の読み書きで、grid 固有のものは何もない。
   2 つ目の同じ形のセットを足すのでモジュールごと一般化する
   （`parseSessionIdLog` / `sessionIdLogLine`）。

2. **`registry.ts` — 永続セット `backgroundSessions`**
   - `~/.mulmoterminal/background-sessions.json`（append ログ）
   - `backgroundSessionsHydrated` promise、`markBackgroundSession(id)`
   - 追記ヘルパは grid 側と共通化（`idLogAppender(file, label)`）
   - `isBackgroundSession(id)` = `hiddenSessions.has(id) || backgroundSessions.has(id)`
   - `backgroundMarkers` — `runWithHiddenMarker` に渡す `{add, delete}` ファサード。
     add で両方に入るので、**呼び出し側が 2 回書くことがない**（呼び出し側は 2 箇所ある）

3. **`hiddenMarker.ts` の呼び出し側 2 箇所** — `hiddenSessions` ではなく `backgroundMarkers` を渡す。
   `hidden:false`（手動 Refresh）は今までどおり何も印を付けない。

4. **`session-reads.ts`** — ワイヤの `hidden` を `isBackgroundSession(id)` に切り替える
   （on-disk 行と pending 行の両方）。副次的に「終了した hidden ワーカーが再び太字になる」既知の穴も塞がる。

5. **`session-list.ts` — 上限をチャットと背景で分ける**
   クライアントが既定で背景を隠すので、上限が 1 本だと**背景が増えるほど本物のチャットが押し出される**。
   画面上は「リストが短くなった」だけで理由がどこにも出ない。
   `isBackground` 述語 + `backgroundLimit` を足し、それぞれ別に上限を取ってから mtime で再マージする。

6. **`session-routes.ts`** — 述語と `backgroundSessionsHydrated` の await を渡す。

7. **刈り取りへの登録（issue 勘所2）** — 既定で見えなくなる以上、#541（76 セッション / 41.8GB）の
   再発を防ぐ側もセットで入れる。
   - `server/index.ts` `feedsSpawnWorker`: `hidden` のときだけ `scheduledSessions.register(id)`
   - `server/routes/plugin-routes.ts` `spawnBackgroundChat`: 同じ理由で `hidden:true` を登録
     （`PluginRouteDeps` にコールバックを 1 つ足す）
   - 順序: `scheduledSessions` は `feedsSpawnWorker` より後で定義されるが、feeds の refresh を
     起動するシステムタスクの登録はさらに後（`initUserTaskScheduler`）なので、呼ばれる時点では必ず初期化済み。

### クライアント

8. **`useSessions.ts`** — `Filter` に `"background"` を追加、`isBackground(s)`、
   純粋関数 `matchesFilter(session, filter)`（`all` は背景を除外する、がここに書かれる）。

9. **`sessionList.ts`** — `useSessionFilter` が `backgroundCount` も返す。空表示の文言は
   フィルタ依存になるので `sessionListEmptyMessage(filter)` を切り出す。

10. **`SessionFilters.vue`** — `Background` チップ。**件数 0 のときは出さない**
    （コレクションを使わないユーザーに空のチップを見せない）。0 になった瞬間にチップが消えても
    `All` は常にあるので詰まない。

11. **`Sidebar.vue` / `SessionTabBar.vue`** — `backgroundCount` を渡す。Sidebar のハードコード
    "No unread sessions" を `sessionListEmptyMessage` に置き換える。

## テスト

- `test/server/session/session-id-log.spec.ts`（改名）
- `test/server/session/session-list.spec.ts` — 背景行が別枠で上限を持つこと、背景が増えても
  チャットが押し出されないこと、cwd スコープ付きクエリでの挙動
- `test/src/composables/useSessions.spec.ts` — `matchesFilter` の全分岐
- `test/src/components/Sidebar.spec.ts` / `SessionTabBar.spec.ts` — チップの出し分けと既定の除外

## やらないこと

- **`onComplete` の接続（issue の PR 2）** — feeds エンジンは hidden ワーカー向けに
  `onComplete` を受け取れるが、MulmoTerminal の runner は捨てている。繋ぐにはセッション層から
  「終わった／失敗した」を渡す経路が要る。フィルタ案では失敗したセッション自体が Background チップの
  裏に残って開けるので、PR 1 とセットである必然性がなくなった。別 PR とする。
- 手動 Refresh（`hidden:false`）の扱いは変えない — デバッグできることが目的なので見えたまま。
