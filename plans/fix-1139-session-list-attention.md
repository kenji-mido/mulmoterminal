# サイドバーとタブバーで「入力待ち」と「未読」を分ける (#1139)

## 何を直すか

#1131 で拡大時の一覧は直したが、**同じ潰れ方**がサイドバーとタブバーに残っていた。

| | working | 停止中（許可・質問） | 未読（終わった） |
|---|---|---|---|
| grid のセル | 脈動ドット | amber 3 チャンネル | 緑リング |
| 拡大時の一覧 | スピナー | amber リング + 点滅 | 緑リング |
| サイドバー | スピナー | **太字だけ** | **太字だけ** |
| タブバー | スピナー | **赤ドット** | **赤ドット** |

原因は `isUnread()`（`useSessions.ts:28`）が `waiting` だけを見ていること。`waiting` は
「答えるまで進まない」と「読めばいいだけ」の両方で立つ。

## やったこと

**1. 判定を 1 箇所に出した。** `activityStatus()` と状態の型を `gridTabs.ts` から
`src/components/attentionStatus.ts` に移し、型名を `CellStatus` → `AttentionStatus` に。
セッション行はセルではないし、3 つのパネルが同じ規則を読むようになったため。
#1098 で `cellPriority` を `dirPriorityOrder.ts` に出したのと同じ形。

**2. サイドバーはスピナーの枠にドットを入れた。** 4 状態は排他なので 1 枠で足りる:

| 状態 | 表現 | アクセシブル名 |
|---|---|---|
| working | スピナー（変更なし） | Claude is working |
| blocked | amber のドット | Waiting for you |
| done | 緑のドット | Finished — unread |
| idle | 何も出さない | — |

**太字は両方に残した。** 太字は「注意が要る」で両方に当てはまり、Unread チップの母集団
（`isUnread`）そのもの。**どちらの種類かはドットの色が言う。**

**3. タブバーは既存の赤ドットを状態から色分けした。** `--err-strong`（赤）は「終わったターン」に
対して意味が強すぎるのでやめた。

**4. 点滅は入れない。** この 2 つは**常に見えている**ので、常時モーションは roster より確実に煩い。
静的な色分けだけなら設定も要らない（#1131 の設定は点滅のためにある）。

## 置き場所

| もの | どこ | 理由 |
|---|---|---|
| 状態の判定 | `src/components/attentionStatus.ts` | 依存ゼロの純ロジック。grid / roster / サイドバー / タブバーが読む |
| ドットのクラスとラベル | `src/composables/sessionList.ts` | 「両レイアウトが共有するもの」の既存の置き場（`SESSION_SPINNER` の隣）。ここに置くと片方だけ更新される形にならない |

色は roster と同じ amber `#f59e0b` / 緑 `#22c55e`。サイドバーの行にはディレクトリ色が乗らないので
#1106 のようなチャンネルの取り合いは起きない。

## レビュー中に自分で見つけたバグ（bot の指摘ではない）

最初の実装はドットの条件を**状態だけ**で書いていた（`sessionDot(sessionAttention(s))`）。
ところが太字と Unread チップを決めている `isUnread` は `waiting && !hidden` で、
**背景ワーカー（`hidden`）を意図的に除外**している。つまり Background フィルタで待っている
ワーカーに:

- ドットは付く（状態だけ見ているので）
- 太字は付かない（`isUnread` が false なので）

**1 行の中で 2 つのチャンネルが食い違う** —— この PR が消そうとしているものそのものだった。

対処: どの行に印を付けるかの判断を `sessionDotFor(s)` 1 箇所に置き、**ゲートは `isUnread`**、
色は状態から決める形にした。これで「印が付く母集団」は従来どおりで、変わるのは色だけになる。
コンポーネント側の spec でも背景ワーカーに印が付かないことを固定した。

## 実機で確認したこと

隔離した `HOME` に**3 本の transcript を作って**（`~/.claude/projects/<encoded-cwd>/<id>.jsonl`）
サーバを `CLAUDE_CWD=/tmp/mt-demo/acme-web` で起動し、`/api/hook` に本物の `Notification` / `Stop`
を投げて計測:

| 行 | 送ったフック | ドットの実測色 | アクセシブル名 | 太字 |
|---|---|---|---|---|
| fix the login redirect | Notification | `rgb(245, 158, 11)` | Waiting for you | 700 |
| add the rate limit header | Stop | `rgb(34, 197, 94)` | Finished — unread | 700 |
| rewrite the install page | なし | ドットなし | — | 400 |

タブバーに切り替えても同じ 2 色・同じラベル。**スクリーンショットでも確認**（#1131 では
computed style だけ見て意図が達成されていなかったので、画面を見るところまでを手順に入れた）。

## やらないこと

- 点滅・音・push 通知は変更なし
- `isUnread` の意味と Unread チップの母集団は変更なし
- 判定ロジック自体は変更なし（移設と改名のみ。既存テストはそのまま通る）
- ガイド（`docs/guide/`）はサイドバーのマーカーを説明している箇所が無いので触っていない。
  README は「need attention（waiting for input, or finished…）」と**2 つをまとめて書いていた**ので、
  そこだけ分けて書き直した
