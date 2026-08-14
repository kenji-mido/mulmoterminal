# refactor: サイドバー削除の取り残しを useSessions から落とす（#1419）

## 背景

#1201 / #1202（4.0.0）で単一ビューと `Sidebar.vue` を消したとき、それらだけが使っていたコードが
`src/composables/useSessions.ts` に残った。

現在 `useSessions()` の利用者は `App.vue:56` の1箇所だけ。しかも使うのは `sessions` だけで、
読まれるフィールドは `useFaviconState.ts` が見る `id` / `working` / `waiting` の3つだけ。

## 方針

**`useSessions` は「ファビコンの権威セッションリスト」に縮める。** 名前は変えない（実体は
`/api/sessions` のままなので）。

## 消すもの

| 対象 | もとの用途 | 消してよい根拠 |
|---|---|---|
| `fetchCodexSessions()` | サイドバーに codex 行を混ぜる | 取得結果は `working:false` 固定。`deriveFaviconState` は idle を無視するので現状なにも変えていない |
| `mergeStable()` / `resort` / `refresh()` | サイドバーの行順を安定させる | `kept ∪ added === incoming` なので集合として同一。ファビコンは順序を見ない |
| mtime 降順ソート | サイドバーの並び | 同上 |
| `matchesFilter()` / `isUnread()` / `isBackground()` / `Filter` | チップ（all / unread / background） | 呼び出し元はテストのみ |
| `loading` / `error` | Loading 表示・エラーバナー | 表示先が無い |
| `Session` の `title` / `mtime` / `event` / `hidden` / `agent` | 描画・ソート・チップ・バッジ | `src` に読み手が居ない（grep 済み） |
| `SessionRow` / `isSessionRow` / `listOfSessionRows` | codex 行のパース | `isSession` に一本化 |

## 残すもの

- `sessions` / `load()` / pub-sub 購読 / reconnect 時の再取得
- **out-of-order ガード**（`issuedRequests` / `lastAppliedRequest`）— 古い答えが新しい答えを
  上書きすると誤った working 状態がファビコンに出る。#620 F4 / #628 の spec も残す
- 失敗時に既存リストを消さない挙動

## 挙動の変化

- **ユーザーから見た変化は無い。** codex 行は idle 固定でファビコンの導出に寄与していなかった。
- **失われるもの1つ**: `/api/sessions` の失敗が `error` に載らなくなる（表示先が無いので実害は
  無いが、fetch 失敗が完全に無音になる）。ファビコンは最後に成功したリストのまま。

## 副次効果

#1417 に申し送りとして書いた「権威リストの `working:false` がライブ活動を上書きする」問題が、
codex / agy 行が権威リストに入らなくなることで到達不能になる。#1417 で一覧 UI を作るときに
復活し得る点は向こうに書いてある。

## やらないこと

- `/api/codex/sessions` と `/api/antigravity/sessions` は**残す**（オーナー判断 2026-08-05）。
  #1417 の一覧 UI の土台。ただし `/api/codex/sessions` のコメントが「単一ビューのサイドバーが
  使う」のまま実体と合っていないので、呼び出し元が無いことを明記するよう直す。
- `useSessions` を `/api/activity` で置き換える案は取らない。あちらは id を明示的に渡す
  スナップショットなので、セッションの発見ができない。
