# 共有コレクション: 作成から公開までの流れ

**状態**: 2026-08-11 の設計議論を反映したシナリオ。決定の根拠は
[`memo-shared-collection-ids.md`](./memo-shared-collection-ids.md)、
全体設計は [`feat-shareable-collections.md`](./feat-shareable-collections.md)。
**実装済みと未実装が混在している** — 各ステップ末尾と最後の表を参照。

---

## この機能は誰のためのものか

| | 何を使うか | 何をするか |
|---|---|---|
| **作る人** | **MulmoTerminal**（プロジェクトフォルダ） | コレクションを作り、名簿を書き、deploy / publish する |
| **使う人** | **Web サイト** | 公開ページから読む・申し込む。メンバーはサインインして自分の分を扱う |

**使う人は MulmoTerminal を持ちません。** 招待された人が自分のホストでそのコレクションを
開く、という形は取りません（そのための機構は落としました）。

---

## 用語 — 3 つだけ

| 用語 | 何者か | 形 | 誰が決めるか |
|---|---|---|---|
| **slug** | コレクションの名前 = スキルのディレクトリ名 | 人間可読 | 作る人（LLM） |
| **cid** | アプリの中でのコレクションの ID | **slug と同じ** | — |
| **aid** | アプリの ID。アプリ = フォルダ 1 つ | **UUID** | **コードが生成**（ステップ 1） |

**なぜ aid だけ UUID か。** `apps/{aid}` は**全ユーザー共通の棚**で、ルールは「自分を
オーナーと名乗ること」しか要求しない — つまり**早い者勝ち**で、人間可読だと先回りして
押さえられます。cid はその aid の下に閉じていて、しかもフォルダ内のディレクトリ名なので、
**ファイルシステムが一意性を保証**します。名前空間の性質が違うので、扱いも違います。

人が配る URL は aid ではなく、**別に確保する slug**です（ステップ 4）。

---

## 全体像

```text
              あなた            LLM                   できるもの
 ──────────────────────────────────────────────────────────────────────────────
 1. アプリ宣言   「共有コレクション  app.json を書く（aid も）  <repo>/app.json
 2. コレクション   を作って」        schemaDocs → putSchema     .claude/skills/<slug>/
 3. 招待        「◯◯さんに権限を」 members を書く             <repo>/app.json
 ──────────────────────────────────────────────────────────────────────────────
 4. deploy      「deploy して」    manageSharedApp/deploy    apps/{aid}, スキーマ, slug 予約
 5. publish     「publish して」   manageSharedApp/publish   apps/{aid}.public, config/public
 ──────────────────────────────────────────────────────────────────────────────
 ──────────────────────────────────────────────────────────────────────────────
 6. 他の人      URL を開く         —                         Web ページ
```

**1 と 2 は 1 つの依頼から続けて起こります** — `app.json` が無いと共有コレクションは
保存自体を拒否されるので、順序は逆にできません（ステップ 1 の末尾）。

**上の並びは番号の順に一度ずつ起こるのではありません。** deploy を何度も挟んで進み、
publish で外に出ます。**publish も一度きりではありません** — 公開設定を変えたら
publish し直します（`unpublish` は「公開をやめる」ときだけ）:

```text
 app.json に何を書いたか        打つもの      その結果
 ─────────────────────────────────────────────────────────────────────────
 aid + スキーマ             →   deploy    自分だけが /staging/{aid} で実データを試せる
   + members（招待）        →   deploy    招待した人も /staging/{aid} を使える
   + public（公開設定）     →   publish   /{slug} が生き、お客さんが来る
```

**操作は 2 つあります。** ひとことで言えば **deploy = staging に出す、publish = staging を
公開に昇格させる**。

| | 何をするか | 何を書くか | 危険度 |
|---|---|---|---|
| **deploy** | **staging に出す**。何度でも打つ | **名簿の人しか読めないもの**だけ（`apps/{aid}` の `public` **抜き**、`staging/{cid}` のスキーマとビュー） | 常に安全。**公開中でも**外には何も出ない |
| **publish** | **staging を公開に昇格させる** | staging の**昇格**（`collections/{cid}`）、**`apps/{aid}.public`（認可の本体）**、`config/public`、`appSlugs` の公開 | 唯一の危険な操作 |

> **staging されるのはスキーマとビューだけです。名簿は staging されません** —
> `members` に足して deploy した招待は**即座に効きます**（そうでないと「招待して一緒に
> テストする」ができません）。外に出るものだけが publish を待ちます。

外に出る文書を作るのは publish だけなので、**テストのために deploy しても何も漏れません**。
`/staging/{aid}` は deploy だけで動きます — 認可はもう `apps/{aid}` の名簿が持っているからです。

> **`publish` と `public` は別物です。** `publish` は**操作**、`public` は
> **`app.json` の中のブロック名**（名簿に載っていない人に何を許すかの設定）。
> `public` を書いて publish すると公開されます。

**Web の入口は 2 つあります**（`/{slug}` は公開の顔、`/staging/{aid}` は名簿の人の入口）。
招待や公開の前に本物で試せるのはこのためです — 詳しくはステップ 5。

**ローカルのファイルは、それ自体では誰にも届きません。** Firestore のルールが読むのは
`app.json` ではなく、deploy が書いた `apps/{aid}` のほうです（`firestore.rules` の
`app(aid)` = `get(apps/{aid})`）。同期する仕組みは無いので、**`members` に足しただけの
招待は効きません** — 効くのは次の deploy の後です。同じ理由で、レコードを書けるように
なるのも 1 回目の deploy の後です（item のルールが全部アプリ文書を引くため）。

---

## ステップ 1 — アプリを宣言する

コレクションが属する「アプリ」を宣言します。**アプリ = フォルダ 1 つ**で、その中の
コレクションが**1 つの名簿**を共有します。

**これが先です。** 共有コレクションは `app.json` の `aid` が読めないと `putSchema` に
**保存を拒否されます**（`a shared collection needs an app: create <root>/app.json
declaring an 'aid'`）。順序は入れ替えられません。

### あなた

> 「美容室の予約を管理する**共有**コレクションを作って。URL は sakura-hair にして」

### LLM

`app.json` を書く（コレクションを作る前に）

### できるもの（ローカル）

```json
{
  "name": "Sakura Hair 予約",
  "slug": "sakura-hair",
  "members": {
    "satoshi@example.com": { "*": "owner" }
  }
}
```

**`aid` はここで決まります。** LLM は書かず、**コードが UUID を生成して `app.json` に
入れます**（LLM に発明させない）。deploy まで待たないのは、`aid` の無い `app.json` では
**次のステップのコレクションが保存を拒否される**からです。UUID なので調整も予約も要らず、
この時点で決めて何の不都合もありません。**`owner` は書きません**（deploy があなたの
uid を刻みます）。

`slug` は**希望**です。既に取られていたら deploy が `sakura-hair-2` のように番号を
付けて予約します。URL が実際に生きるのは publish のときです（ステップ 4）。

**実装状況**: `aid` の自動生成と `slug` は**未実装**（いまは aid を手で書く）。

---

## ステップ 2 — コレクションを作る

### あなた

同じ依頼の続きです。あなたはもう一度言う必要はありません。

### LLM

1. `manageCollection` の **`schemaDocs`** — スキーマの書き方を読む
2. **`SKILL.md`** と **`schema.json`** を書く（新規作成はファイル書き込み）
3. `manageCollection` の **`putSchema`** — 検証して保存

### できるもの（ローカル）

```text
<プロジェクトフォルダ>/.claude/skills/bookings/
├── SKILL.md
└── schema.json
```

```json
{
  "title": "予約", "icon": "event",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "fields": { }
}
```

`storage.type: "firestore"` が「これは共有する」という宣言です。**cid は書きません** —
ディレクトリ名（`bookings`）がそのまま cid になります。

> **このフォルダには非共有のコレクションを置けません。** `app.json` があるフォルダの
> コレクションは全部 firestore ストレージである、という規則です。フォルダの性格を
> 1 つに定めるためで、下書きやローカル専用のメモは別のフォルダに置きます。

**実装状況**: 動く。ただし「混在禁止」の規則は**未実装**。

---

## ステップ 3 — 権限を与える

`members` に**メールアドレス**を足すだけです。相手の事前登録は要りません。

```json
{
  "members": {
    "satoshi@example.com": { "*": "owner" },
    "tanaka@salon.jp":     { "bookings": "editor" }
  },
  "public": {
    "enabled": true,
    "submit": {
      "bookings": {
        "auth": "verifiedEmail",
        "createFields": ["customerName", "customerEmail", "startAt", "status"],
        "initialStatus": "pending"
      }
    }
  }
}
```

### ロール

| ロール | できること |
|---|---|
| **owner** | 全部 + **deploy / publish** + 名簿の編集 |
| **editor** | レコードの読み書き |
| **viewer** | レコードの読み取り |
| **participant** | **自分の行だけ**読める |

`"*"` はアプリ全体、`"bookings"` はそのコレクションだけ。上の田中さんは**予約だけ** editor。

`public.submit` は**名簿に載っていない人**（お客さん）向けの投稿口です。

> **`memberEmails` は書きません** — deploy が `members` から生成します。Web ページが
> 「自分が参加しているアプリ」を引くための項目で、手で書くと不一致でルールに拒否されます。
>
> **足しただけでは効きません。** ルールは `app.json` を読まないので、招待が有効になるのは
> **次の deploy の後**です。

**実装状況**: 動く。

---

## ステップ 4 — deploy する（何度でも）、そして publish する（一度だけ危険）

ローカルの宣言を Firestore に反映する操作が **deploy**、それを外に開く操作が **publish** です。

### あなた

> 「deploy して」 …… 動作確認と招待はここまでで足ります
> 「publish して」 …… お客さんに開くときだけ

### LLM

MT 独自のホストツール **`manageSharedApp`** の `deploy` / `publish`
（取り下げは同じツールの `unpublish`。この 3 つで全部です）
（`manageCollection` には足しません — あれは core にあるツールで、共有アプリの操作は
MT だけの機能だからです。詳しくは本文の D5）

### deploy がやること

1. `app.json` を読む — **`aid` はステップ 1 で決まっているので、そのまま使う**
   （deploy は `aid` を作らない。`apps/{aid}` という**置き場所ができる**のがここ）
2. **拒否できるものを全部拒否する**（下記）
3. **ライブレコードを事前検証** — 新スキーマで壊れる既存レコードがあれば**止まる**
   （`confirm` で強行可能。移行の途中など、staging で先に進めたいことがあるため）
4. **`apps/{aid}` を置換で書く** — ただし **`public` ブロックは書かない**（下記）。
   **`previousPublished` にも触りません** — 巻き戻し先を動かすのは publish だけです。
   草稿を deploy しただけで rollback の行き先が変わってはいけないので
5. **`staging/{cid}` に書く** — スキーマとビュー、**そのコレクションのルール設定**
   （`transitions` / `immutable` / `submitOnly` …）、`participantRead` に入るかどうか、
   そして記名（`deployedAt` / `deployedBy` / `deployedCommit`）。公開ページはここを
   読めないので、**公開中のアプリでも見た目も挙動も変わりません**（下記）
6. **URL slug を予約する** — 希望が空いていればそれ、取られていたら番号を付ける。
   予約できたら `app.json` に書き戻す（以降は再生成しない）。**この時点では誰も
   辿れません**（下記）。**4 より後**なのは、`appSlugs` の作成ルールが
   `get(apps/{aid})` でオーナーを確認するため — アプリが無いと予約が拒否されます

### publish がやること

1. **昇格する版をもう一度ライブレコードで検証する** — deploy の検証を引き継ぎません。
   deploy は `confirm` で強行できるので、**強行された草稿がそのまま公開に出ないよう、
   公開の境界でもう一度見ます**。壊れるなら**止まる**（publish 自身の `confirm` が要る）
2. **`staging/{cid}` を `collections/{cid}` に昇格させる** — 公開ページが読むスキーマと
   ビューが、ここで初めて差し替わる。**前の版が `previousPublished` に退避されるのも
   ここ**（巻き戻し先は「いま公開されている版」なので）
3. **staging に載っていたルール設定を `apps/{aid}` に載せる** — 各 `staging/{cid}` の
   ルール設定から `collections` を、`participantRead` に入っていた cid から
   `participantRead` を組み立てて**置換**します。**2 と一緒でなければいけません** —
   新しいスキーマを公開しながら公開の書き込みだけ古い制約で判定される、が起きるので
4. `config/public` を書く（描画用の射影）
5. `appSlugs/{slug}` を `published: true` にする
6. **`apps/{aid}` に `public` ブロックを載せる** — **これが認可の本体。だから最後**

**順序が逆なのは意図的です。** 匿名アクセスを開くのは **6（`apps/{aid}.public`）だけ**で、
4 の `config/public` は描画用の射影にすぎません。**最後に開けば途中で失敗しても公開が
半端に開きません**。逆順だと「匿名アクセスは有効、描画データは
古いか無い」という最悪の状態になります。可能なら 1 つの batch で書きます。
`unpublish` はちょうど逆順（`public` を外すのが最初）。

公開設定を変えたいだけなら **publish し直せば済みます**（`unpublish` は要りません）。
再 publish は前版を `previousPublished` に退避して置き換えます。

> **書き方は `set`（置換）で、merge ではありません。** merge は**削除できない**ので、
> `members` から 1 人消しても権限が残り、しかもルールが `memberEmails` との一致を
> 要求するため**その deploy 自体が拒否**されます。代わりに、相手の操作が持つもの —
> `public` / `collections` / `participantRead` / `published*` / `previousPublished` —
> は**現在値をそのまま持ち越す**ので、置換しても公開は巻き戻りません。

### できるもの（Firestore）

```text
deploy が書く（名簿の人だけ）
apps/{aid}                        ← 名簿・内部設定。public ブロックは含めない
  └── staging/bookings            ← スキーマとビューの草稿。/staging/{aid} が描画に使う
appSlugs/sakura-hair              ← { aid, published: false } 予約だけ。誰も引けない

publish が書く（外に出る）
apps/{aid}/collections/bookings   ← staging からの昇格。公開ページが読むのはこちら
apps/{aid} の public ブロック      ← ルールが匿名アクセスを判定するのはここ
apps/{aid}/config/public          ← 描画用の射影（未ログインでも読める。名簿は含まない）
appSlugs/sakura-hair              ← published: true にする（ここで URL が生きる）
```

> **staging があるので、公開後も deploy は安全です。** 公開ページはスキーマを
> `collections/{cid}` から読み、deploy が書くのは `staging/{cid}` だからです。
> ドキュメントを分けているのは、ルールが**フィールド単位では隠せない**ため —
> 公開ページが読めるドキュメントに草稿を入れれば草稿も読まれます。
>
> **レコードのツリーは 1 つのまま**で、staging はスキーマとビューの置き場所です。
> だから `/staging/{aid}` で試したレコードはそのまま本番のレコードになります。
> **スキーマの変更は後方互換である限りエラーになりません** — 公開中の古いスキーマは、
> 増えたフィールドを知らないだけで既存のレコードを読み続けられます。後方互換でない
> 変更は publish のライブレコード事前検証が止めます。

> **急所は `config/public` ではなく `apps/{aid}` の `public` ブロック**です。ルールが
> 匿名アクセスを判定するのに読むのはアプリ本体のドキュメント（`publicOn` は
> `a.public.enabled`、`subOpen` は `a.public.submit`）で、`config/public` は描画用の
> 射影にすぎません。**deploy がここに `public` を書くと、その瞬間から匿名アクセスが
> 有効**になり、`config/public` を伏せても止まりません。しかも `submit` 側は
> `enabled` すら見ないので、「`enabled: false` なら安全」も成り立ちません。
> ブロックが**無い**状態は非公開です（`publicOn` は `"public" in a` を先に見ます）。
>
> **予約と公開を分ける理由。** slug は人間可読なので、`appSlugs` が最初から引けると
> **slug を当てるだけで aid が手に入り**、`/staging/{aid}` が推測可能になります。
> `allow read: if resource.data.published == true` にすれば、**早く押さえられて、かつ
> 公開まで誰も辿れません**。**UUID の推測しにくさを認可の境界にしない**、が原則です。

### deploy が拒否するもの

エラーではなく**設計の門番**です:

- **投稿者に紐づくレコードなのに `submitOnly` が無い** → オーナーが他人の名前でレコードを作れる
- **`createFields` に primaryKey が入っている** → 投稿者が他人のレコードの ID を名乗れる
- **`window` の期限が逆** / **`initialStatus` に対応する `statusField` が無い** →
  誰も投稿できなくなる（しかも**エラーが出ない**）
- **リポジトリに無いコレクションを名指ししている** → 宣言が黙って無効になる

> **記名。** 誰が・どのコミットから・いつ deploy したかが `deployedAt` /
> `deployedBy` / `deployedCommit` に記録されます。**「いま公開されている版」を指す
> `publishedAt` / `publishedBy` / `previousPublished` は publish だけが書きます** —
> 草稿を deploy しただけで巻き戻し先が動いてしまわないように。作業ツリーが汚れていれば
> その印が付きます（そのコミットは中身を説明していないため）。

**実装状況**: core の `publishApp`（deploy と publish を兼ねた旧経路）は
**mulmoclaude#2871 で削除する予定 — まだレビュー中**なので、いまは生きている。
**MT 側の `manageSharedApp` は未実装**で、着手は #2871 のマージと npm 公開を待つ。
3〜5 は動く。**2（slug の予約）は未実装**で、`appSlugs` のルールを mulmoserver に足す
必要があります（凍結インフラへの 2 回目のデプロイ）。ステップ 1 の `aid` 自動生成も未実装。

---

## ステップ 5 — 他の人が使う

### 入口は 2 つ

```text
https://<host>/sakura-hair     公開の顔。お客さん向け
https://<host>/staging/{aid}       名簿の人の入口。slug を経由しない
```

**公開ページ**（`/sakura-hair`）は `appSlugs/sakura-hair` から aid を引き、
`apps/{aid}/config/public` を読んで描きます。**未ログインでも読めます**
（`config` だけが `allow read: if true`）。

**名簿の人の入口**（`/staging/{aid}`）はサインインしてからロールを引いて描く管理側の画面です。
**deploy だけで動きます**（publish は要りません）。だから**招待や公開の前に実データで
動作確認できます**。認可は
すでにルールが持っているので、Firestore 側に足すものはありません — 足りなかったのは
slug を経由しない経路だけです。aid は UUID なので URL 自体が推測不能です。

> **公開後も消えません。** お客さんは `/sakura-hair`、スタッフは `/staging/{aid}` で
> 承認作業をする、という使い分けがそのまま残ります。名簿の人が見るのは常に
> **staging の版**（`staging/{cid}`）で、お客さんが見るのは**昇格済みの版**です。

**検証用に別の aid を立てる形は採りません。** テストで入れたデータが本番に持ち越せず、
「検証用のアプリでは動いたのに本番にそのデータが無い」を作るためです。aid もレコードのツリーも 1 つのままです。

### 誰が何をできるか

| 相手 | 何をするか | 認可 |
|---|---|---|
| **あなた / 田中さん** | `/staging/{aid}` で実データを試す（公開前でも） | サインイン → ルールが `members` からロールを引く |
| **お客さん** | 予約を申し込む | `public.submit` の宣言。`auth: "verifiedEmail"` ならメール確認済みのサインインが要る |
| **田中さん（editor）** | 予約を承認する | サインイン → ルールが `members` からロールを引く |
| **あなた（owner）** | 全部 + publish | 同上 |

**MulmoTerminal は要りません。** ルールが `request.auth.token.email` を `members` に
突き合わせるので、認可はサーバー側（Firestore）で完結します。

**実装状況**: Firestore ルールは本番に反映済みで動く。**Web ページ自体が未実装** — `/staging/{aid}` が実装順 9、
`/{slug}` が実装順 12。

---

## まとめ — どこに何があるか

| | ローカル（git） | Firestore |
|---|---|---|
| **スキーマ・ビュー・ルール設定（草稿）** | `.claude/skills/<slug>/schema.json` + `app.json` の `collections` | `apps/{aid}/staging/{slug}`（deploy） |
| **スキーマ・ビュー（公開）** | 同上 | `apps/{aid}/collections/{slug}` の `publishedSchema`（publish が昇格） |
| **名簿・公開設定** | `app.json` | `apps/{aid}` / `apps/{aid}/config/public` |
| **URL の予約** | `app.json` の `slug` | `appSlugs/{slug}` |
| **レコード** | — | `apps/{aid}/collections/{slug}/items/*` |

**git のものが正**で、Firestore は deploy が作った**射影**です。逆流はしません。

---

## 実装状況（2026-08-11）

| | 状態 |
|---|---|
| コレクション作成 / 名簿 / 反映の本体 | **動く** — ただし `@mulmoclaude/core` 3.8.0（**npm 未公開**、npm は 3.7.0）。**MulmoTerminal が lock しているのは 3.3.0** なので、上げるまでこのリポジトリからは新しい部分に触れない。Firestore ルールは本番に反映済み |
| **deploy / publish の分割** | **未実装**（決定済み）。いまは core の `publishApp` 1 つが両方やる。分割後は MT 独自ツール `manageSharedApp` が持つ（実装順 7c） |
| **MulmoClaude を触る変更** | **2 本で打ち止め**（実装順 7a）: mulmoclaude#2870（能力の宣言 + バインド解除、**マージ済み**）と #2871（deploy / publish の投影・staging・appSlugs の置き場所・旧 `publishApp` の削除、**レビュー中**）。以降 MT の作業は core 変更なしで進む |
| `aid` の UUID 自動生成 | **未実装**（決定済み） |
| URL slug の確保 + `appSlugs` のルール | **未実装**（決定済み。ルールの 2 回目のデプロイを含む） |
| **staging（スキーマ・ビューの草稿）** | **未実装**（決定済み）。`match /staging/{cid}` を上と同じデプロイに相乗りさせる |
| 「共有と非共有を混ぜない」規則 | **未実装**（決定済み） |
| **MulmoTerminal から使えること** | **未実装** — Firestore のセッションを繋いでいない。**いま繋がっているのは MulmoClaude だけで、そちらは設計上サポート対象外**（D5） |
| MulmoClaude のワークスペースでの拒否 | **未実装**（決定済み） |
| Web の公開ページ | **未実装**（実装順 9 / 12） |

**既知の穴**: 同時に 2 人が反映すると版が混ざりうる（mulmoclaude#2866）。
手動・低頻度なので当面は受容。
