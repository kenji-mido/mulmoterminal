# feat(github): work comment が書けなかった理由を言う (#1369)

## 残っていた判断

#1376 で「1 issue につき 1 コメントを編集し続ける」までは入った。issue の
「判断が要る点」のうち、**唯一そのまま残っていた**のがこれ:

> `gh` の権限。書き込みが要るので、読み取りだけで運用している人には出せません

`issueWorkComments` を on にして、`gh` が書き込めない状態だと、**何も起きず、理由もどこにも出ない**。
沈黙が三層ある:

| 層 | 場所 | 何を捨てているか |
| --- | --- | --- |
| 1 | `ranOk` (`server/git/work-comment.ts:107`) | `gh` の stderr を丸ごと捨てる |
| 2 | `ensureWorkComment` | あらゆる原因を `reason: "gh-failed"` 1つに潰す |
| 3 | `postWorkComment` (`src/composables/useWorkItem.ts:91`) | レスポンスを読まず `catch {}` |

**「作業は止めない」は正しい。「理由を言わない」が間違い。** ここを分ける。

## 何で分類するか — 実測した ground truth

英文メッセージの照合ではなく、`gh` / `glab` が自分で書く **HTTP ステータス番号**で分ける。
書式は 2 種類あるが、どちらも `HTTP <status>` を含む（このマシンで実行して確認した）:

```
$ GH_TOKEN=bogus gh api ... --method PATCH repos/o/r/issues/comments/1 -f body=x
gh: Bad credentials (HTTP 401)

$ GH_TOKEN=bogus gh issue comment 1 --repo octocat/Hello-World --body x
HTTP 401: Bad credentials (https://api.github.com/graphql)
Try authenticating with:  gh auth login

$ gh api repos/torvalds/linux/collaborators          # 本物の token で本物の 403
gh: Must have push access to view repository collaborators. (HTTP 403)

$ GITLAB_TOKEN=bogus glab api projects/.../notes
glab: 401 Unauthorized (HTTP 401)
```

bogus token を使ったのは **書き込みを一切発生させずに書き込み系コマンドの失敗を見る**ため。
401 で止まるので、`octocat/Hello-World` には何も投稿していない。403 のほうは、逆に
**読み取り専用で 403 になる GET**（collaborators）を本物の token で叩いて採取した。

| ステータス | 分類 | 意味 |
| --- | --- | --- |
| 401 | `auth` | ログインしていない / token が失効した |
| 403 | `permission` | ログインはできているが、この repo に書けない — **この issue の本題** |
| その他 / ステータス無し | `unknown` | ネットワーク、タイムアウト、レート制限 |
| spawn 失敗 | `cli-missing` | `gh` / `glab` が PATH に無い |

404 は `permission` に**入れない**。書き込み前に同じ issue の `view()` は成功しているので、
その後の 404 は「コメントが消された」可能性があり、権限だと断定すると嘘になる。

## 設計

### `common/workCommentFailure.ts`（新規・両側共有）

`WorkCommentFailure = "cli-missing" | "auth" | "permission" | "unknown"` と型ガードだけ。
**サーバが作り、UI が言葉にする**値なので `common/`（リポジトリ規約どおり）。

### `server/git/forge-failure.ts`（新規）

`classifyForgeFailure(stderr)`。分類関数はサーバ側にだけ置く — UI は分類しない。
`gh.ts` / `glab.ts` の「見つからない」文言を**定数として export** して突き合わせる
（文言は 1 文字も変えない。既存の出力と test を動かさないため）。

### `server/git/work-comment.ts`

- ops の戻りを `boolean` から `WorkCommentFailure | null`（null = 成功）に変える
- `WorkCommentResult` に `failure?: WorkCommentFailure` を足す。`reason: "gh-failed"` は**残す** —
  既存の読み手の契約を壊さない
- `view()` の失敗も同じ分類にかける（読めない理由も 401 なら `auth`）
- **失敗は memo しない**（現行どおり。次の節目で再試行される）
- サーバログに **(repo, 原因) につき 1 回だけ** warn。運用者向け

### `src/composables/useWorkItem.ts`

`postWorkComment` がレスポンスを読み、`failure` を返す。`useWorkItem` が
`commentFailure: Ref<WorkCommentFailure | null>` を出す。成功したら null に戻す。

### `src/composables/workCommentNotice.ts`（新規）

「この原因はもう伝えた」を**モジュール値**で持つ（`issueWorkComments.ts` と同じ形）。
セル 9 枚が同じ token で同じ 403 を踏むので、**1 枚で閉じたら全部黙る**。原因ごとに持つので、
`auth` を閉じたあとに `permission` が出たら、それは改めて言う。

### `src/components/WorkCommentNotice.vue`（新規）

`CellTidyPrompt.vue` と同じ形 — セルヘッダの小さい dismissible な chip。
`work` チップを消しているユーザーにも出す必要があるので、設定可能な chip 一覧の外に置く
（tidy prompt と同じ理由）。

原因ごとの文言:

| 原因 | 出す言葉 |
| --- | --- |
| `cli-missing` | `gh not found — issue not updated` |
| `auth` | `gh not logged in — issue not updated` |
| `permission` | `no write access — issue not updated` |
| `unknown` | `could not update the issue` |

## テスト

- `classifyForgeFailure`: 上で採取した**実際の 4 種類の stderr そのもの**を入力にする。
  ステータス無し / 空文字 / 両 CLI の not-found 定数
- `ensureWorkComment`: 401 で `failure: "auth"`、403 で `"permission"`、
  失敗は memo されず次回また試すこと
- `workCommentToPost` は変更なし（既存の spec がそのまま通ること）
- `useWorkItem`: 失敗レスポンスで `commentFailure` が立ち、成功で戻ること
- notice のモジュール状態: 1 枚で dismiss すると他も黙る / 別の原因は黙らない

## 動作確認（外部の ground truth）— 実施済み

ユニットテストは自分が書いた fake を相手にするので、それだけでは「`gh` がそう出力する」の
裏取りにならない。実物で通した:

1. **本物の `gh` で `ensureWorkComment` を 3 経路**（`receptron/mulmoterminal#1369` 宛て。
   いずれも読み取り段階で失敗するので、**issue には何も書いていない**）:

   | 条件 | 結果 |
   | --- | --- |
   | `GH_TOKEN=bogus_xxx`（401） | `{"posted":false,"reason":"gh-failed","failure":"auth"}` |
   | ログアウト（token 空・空の `GH_CONFIG_DIR`、**ステータス無し**の経路） | 同上 `failure:"auth"` |
   | `PATH` から `gh` を外す | `failure:"cli-missing"` |

   サーバログにも 1 回だけ `[work-comment] receptron/mulmoterminal: …` が出た。

2. **403 → `permission` はライブ再現していない。** 権限の足りない token が手元に無く、
   他人の repo へ実際に書き込みを試すのは論外なため。代わりに、権限不足で 403 を返す
   **読み取り**（`gh api repos/torvalds/linux/collaborators`）で本物の 403 stderr を採取し、
   それを spec の入力に使っている。

3. **アイコンが実在するか**を実ブラウザ（puppeteer）で測定。`comments_disabled` は
   既知の良い例 `task_alt` と同じ 1 グリフ幅（48px）に畳まれ、存在しない名前は 1152px の
   まま。ユニットテストでは見えない「文字列がそのまま出る」不具合を潰した。

4. Tailwind の `border-border` / `bg-elevated` / `text-muted` がビルド後の CSS に
   生成されていることを確認（クラス名を間違えても build は通り、無スタイルになるだけなので）。

## ドキュメント

`docs/guide/{en,ja}/config.md` の `issue-work-comments` 節の最後の箇条書き
（"Needs `gh` installed and logged in … nothing breaks"）を書き換える —
**黙って諦めるが、理由はセルに出る**に。README.md の表の 1 行も同じ。

## やらないこと

- **CI の合否**（#1376 で判断済み・据え置き）
- **マージ時の通知**（issue で「使ってみて不便なら再考」と保留された判断）
- 書き込み権限の**事前**チェック。`repos/:o/:r` の `permissions.push` は答えにならない —
  **public repo は push 権限が無くても issue にコメントできる**ので、事前判定は嘘をつく。
  実際に起きた失敗を報告する。
