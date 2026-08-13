# refactor: 単一ビューの GUI MCP サーバー ID を `mt` に短縮する

## きっかけ

「`presentChart` という MCP が、実際には `mcp-mulmoterminal_gui-presentChart` という長い名前に
なるのはなぜか。短くできるか」という質問。

## 何が起きていたか

ツール名はクライアントが**サーバー ID で必ず修飾する**。

| クライアント | 形 | 例 |
| --- | --- | --- |
| Claude Code | `mcp__<id>__<tool>` | `mcp__mulmoterminal-gui__presentChart` |
| Codex | `mcp-<id>-<tool>`（ID 内の `-` は `_` に正規化） | `mcp-mulmoterminal_gui-presentChart` |

つまり ID の長さは**ツール 1 個につき 1 回、リスト表示のたびに、セッションが終わるまで**払う。
`mulmoterminal-gui` は 17 文字を使って、周囲の設定がすでに言っていることを繰り返していた。

## ID は 2 つあり、所有者が違う

ここが判断の分かれ目で、最初は「`mulmoterminal-render` も壊れる」と誤って説明した。実際は独立している。

| | workspace セル / 単一ビュー | project ディレクトリのグリッドセル |
| --- | --- | --- |
| 配送 | spawn ごとに生成する `--mcp-config` / `-c mcp_servers.<id>.url=` | ユーザー自身の `.mcp.json`、`claude mcp add -s local` |
| ID | `GUI_SERVER_ID` | `toolGroupServerId()` = `mulmoterminal-<group>` |
| 所有者 | **こちら**（ディスク上のどのファイルにも残らない） | **ユーザー**（設定ファイルのキーそのもの） |

分岐は `server/session/spawn-claude.ts` の `carriesFullGuiMcp()`。

したがって:

- `GUI_SERVER_ID` は自由に改名できる → `mt` に短縮した。
- グループ ID は改名すると、既に書かれた `.mcp.json` がエラーなしで静かに効かなくなる。ランチャーの
  グループ切り替えも同じ ID を読み戻し、セットアップガイドにも載っている。**やるなら移行処理が必要**で、
  今回のスコープ外。**触っていない。**

## やったこと

1. **定数を `common/toolGroups.ts` に集約。** それまで 4 箇所にリテラル／別名定数として散っていた
   （`mcp-config.ts` のローカル定数、`plugins-registry.ts` の `MCP_SERVER_NAME`、`broker.ts` の直書き、
   `index.ts` の `allowedTools` 文字列）。散っていたこと自体が、改名を実際より怖く見せていた。
2. **`LEGACY_GUI_SERVER_IDS` を追加。** 旧 ID を認識し続ける必要がある 2 箇所のため:
   - `app-config.ts` の `RESERVED_MCP_IDS` — 古いセッションが今も書きうる ID をユーザーに奪わせない
   - `antigravity-mcp.ts` の `OUR_SERVER_IDS` — 自分が書いたエントリを ID で消す処理。落とすと
     `.agents/mcp_config.json` に `mulmoterminal-gui` が永久に残る
3. **非対称性を明文化。** 同じツールが workspace セルでは `mcp__mt__presentChart`、project セルでは
   `mcp__mulmoterminal-render__presentChart` になる。**知らないとバグに見える**ので、README に表付きの
   節、両定数に相互参照コメント、`carriesFullGuiMcp` の doc に「これが差の原因」、CLAUDE.md に
   「統一するな／グループ ID を短縮するな」というルールを置いた。

## 検証

`yarn typecheck` / `format` / `lint`（0 errors）/ `yarn test` 7722 passed。
`test/common/toolGroups.spec.ts` に 2 本追加 — ID が短いことと全グループ ID と衝突しないこと、
旧 ID を消していないこと。

## レビュー指摘への対応（codex-review）

`mt` は短くありふれているので、**すでに `mt` という id を使っていたユーザーのエントリを奪う**という指摘。
2 箇所で実害があった。どちらも「ユーザーが所有するファイルを、こちらが黙って壊す」形だったので直した。

**1. `sanitizeUserMcpServers` が drop していた。** sanitize 後の形が次回の save でそのまま書き戻されるため、
無関係な設定を 1 つ変えただけでユーザーの `config.json` から**恒久的にエントリが消える**。`mt` はこの
リリース前まで合法な id だった。→ **drop をやめて残す**ように変更。衝突は `mcpConfigJson` で決着していて
（ユーザー側を先に書き、組み込みを後で上書きする）、そちらが本来の解決地点。到達不能になることだけ
`console.warn` で伝える。他の reject（不正 id、http(s) でない url、重複）は従来どおり黙って落とす — 見れば
壊れているとわかるため。

**2. Antigravity の設定マージが `mt` を削除していた。** `OUR_SERVER_IDS` に `GUI_SERVER_ID` を入れていたが、
**この経路は all-tools エントリを一度も書いていない**（書くのはグループ ID だけ。all-tools は claude/codex の
spawn 設定側）。つまり自分が作っていないエントリを id 一致だけで消す状態だった。→ `GUI_SERVER_ID` を外し、
`LEGACY_GUI_SERVER_IDS`（このファイルが過去に実際に書いた）とグループ ID だけにした。

**3.（2 巡目の指摘）警告が広すぎた。** 1 の対応で drop をやめた結果、`mcpConfigJson` が上書きするのは
`GUI_SERVER_ID` だけなので、**`mulmoterminal-gui` という名前のユーザーサーバーは普通に到達可能**になる。
そこに「到達不能だから改名しろ」と警告するのは嘘。→ 警告条件を `id === GUI_SERVER_ID` に絞り、
`RESERVED_MCP_IDS` は廃止。`LEGACY_GUI_SERVER_IDS` は**こちらが実際に書いた場所**（Antigravity のマージ）
だけで意味を持つ、という切り分けに落ち着いた。

id 自体は `mt` のまま。設定ファイルを書き換える移行はしない — id の改名はそれを参照している側も壊すので、
ユーザーの判断であってこちらが勝手にやることではない。

## 残り

- 既存セッションは旧 ID の `--mcp-config` を持ったまま走っている。新しい名前になるのは次の spawn から。
- グループ ID 側の短縮（`mt-render` など）は未着手。やるなら既存の per-folder 設定を書き換える移行が要る。
