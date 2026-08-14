# 共有アプリ: 行スコープの書き手ロール `assignee`

**状態**: 設計のみ。実装は未着手。2026-08-12 の議論から。
全体設計は [`feat-shareable-collections.md`](./feat-shareable-collections.md)、
流れは [`shared-collection-flow.md`](./shared-collection-flow.md)。

**この変更は 3 リポジトリにまたがる** — `../mulmoserver`（ルール）、
`../mulmoclaude/packages/core`（宣言と検査）、ここ（MulmoTerminal）。順序が重要なので
最後の節を先に読んでもよい。

---

## 解きたいこと

シナリオ 1（美容室）で、**美容師が自分の担当予約だけを承認できる**ようにしたい。今はできない。

`bookings: editor` を持つ美容師は、`updateWith` の

```
writerOf(a, cid) || (ownRow(...) && !finalize && inWindow && selfWriteOk(...))
```

の左側を通る。`writerOf` は**行を見ない** — `role(a, cid) in ["owner", "editor"]` が真なら
そのコレクションの全レコードが対象で、美容師 A は美容師 B の予約も承認できる。

右側も使えない。`ownRow` は**投稿者本人**を判定する関数で、`subOpen(a, cid)`（`public.submit`
の宣言）が前提であり、突き合わせるのは `idFrom` の uid か `s.emailField` の値。美容室の
`emailField` は `customerEmail` なので、`ownRow` の言う「自分の行」は**客の行**であって
担当者の行ではない。`emailField` は submit 宣言に 1 つだけで、しかも create 時に
`request.auth.token.email` との一致を強制されるため、担当者用に流用もできない。

つまりロールの解決は「メンバー × コレクション」の二次元までで、**行という第三の軸がない**。

---

## 絞りはコレクションではなく人に付く

素直な案は `collections.bookings.scopeField` を足して「bookings の editor は自分の行だけ」に
することだが、これは**受付係が書けなくなる**ので破綻する。受付は全予約を触る editor でいて
ほしいのに、絞りがコレクション単位でかかる。逃げ道は受付を owner にすることだが、owner は
publish 権限（= 全メンバーのブラウザで JS を実行する権限）であり、承認のために配るものでは
ない。

名簿はすでに「人 × コレクション」の二次元を持っているので、**5 つ目のロール**を足す。

```json
"members": {
  "owner@salon.jp":     { "*": "owner" },
  "reception@salon.jp": { "bookings": "editor" },
  "stylist-a@x.jp":     { "bookings": "assignee", "shifts": "viewer" }
},
"collections": {
  "bookings": { "assigneeField": "stylistEmail", "statusField": "status", "transitions": { ... } }
}
```

### 名前を `assignee` にした理由

既存の 4 つ（`owner` / `editor` / `viewer` / `participant`）はいずれも**その人がアプリに対して
何であるか**を指す普通名詞であって、仕組みの名前ではない。`scopedEditor` / `rowEditor` は
説明的で分かりやすいが、名簿に並べた瞬間に浮く。

必要なのは `participant` の対になる概念である:

| | 対象の行 | 読み | 書き |
|---|---|---|---|
| `participant` | **自分が出した**行 | 自分の行だけ | 自分の行だけ |
| `assignee` | **自分に割り当てられた**行 | **全件** | 自分の行だけ |

両者を分けているのは「その行が自分のものである理由」で、片方は投稿、もう片方は**割り当て**。
美容室の担当美容師、タスク台帳の担当者、査読の割り当て — 同じ語で通る。次点は `staff` だが、
権限ではなく組織上の立場を指す語なので、学校の採点者やタスク担当者に当てると嘘になる。
`agent` は Claude Code のエージェントと衝突、`member` は `members` マップと紛れる。

設定キーを `scopeField` ではなく **`assigneeField`** にするのも同じ理由で、`statusField` が
`transitions` の対象を指すのと同じ形。`scopeField` では、その値がロールの何と突き合わされる
のかが名前から読めない。

> **この名前は後から変えられない。** デプロイ済みルールが文字列を直接比較しており、値は
> ユーザーがコミットした `app.json` と公開済みアプリのドキュメントの両方に入る。改名は移行
> 作業になる（`toolGroupServerId()` と同じ性質）。実装前に確定させること。

### 読みは絞らない

`assignee` は `readerOf` に**入れる**。美容師は当日の全体スケジュールを見る必要があり、読みまで
絞ると使い物にならない。絞るのは書きだけ。`participant` との非対称はここに出る。

---

## 突き合わせる値

ルールが比較できるのは `email()` だけ。一方 `ref` フィールドが保存しているのは参照先の
**主キー slug**（`stylist-a`）であってメールアドレスではない。3 案あり、**案 2 を採る**。

| 案 | 形 | 代償 |
|---|---|---|
| 1 | `stylists` の主キーをメールアドレスにする | 公開ページに出るとスタッフのアドレスが露出 |
| **2** | **専用の `stylistEmail` フィールドを持つ**（`ref` は表示用に残す） | 二重管理 |
| 3 | ルールから `stylists/{slug}` を `get()` して引く | 文書アクセスが 1 件増える。承認のたびに 1 read 課金 |

案 2 は「ルールが読む値は宣言で明示され、間接参照しない」という既存方針と揃う（`window` を
epoch millis に落としている、集計キーを 2 個に上限を切っている、`mail` の宛先をレコードから
再導出している、いずれも同じ思想）。案 3 は上限（単一文書リクエストで 10 件）に対して余裕は
あるが、`app(aid)` + `session`（`gateOn`）+ 親（`revealGated`）を既に使っており、安くはない。

---

## ルールの差分（`../mulmoserver/firestore.rules`）

**`get()` は増えない。** すべて `resource.data` / `request.resource.data` だけを見る。

```
function assigneeField(c)   { return c.get("assigneeField", null); }
function scopedWriter(a, c, cid) {
  return role(a, cid) == "assignee" && assigneeField(c) != null;
}
// 変更前 / 変更後、それぞれの担当が自分か。`in` ガードが先（フィールドが無ければ fail closed）
function assignedBefore(c) {
  return assigneeField(c) in resource.data
      && resource.data[assigneeField(c)] == email();
}
function assignedAfter(c) {
  return assigneeField(c) in request.resource.data
      && request.resource.data[assigneeField(c)] == email();
}
```

触る箇所は 4 つ。

- **`readerOf`** — `"assignee"` を含める。
- **`updateWith`** — `writerOf(a, cid) || (scopedWriter(...) && assignedBefore(c) && assignedAfter(c)) || (既存の ownRow 経路)`。
  **変更前と変更後の両方**を見るのが要点。変更前だけだと他人の予約を自分に付け替えられ（乗っ取り）、
  変更後だけだと自分の予約を他人に投げてから何でもできる。担当替えを許したければ
  「変更後は不問」を別途宣言にする（初版では許さない）。
- **`createWith`** — `scopedWriter(...) && assignedAfter(c) && !flagOn(c, "submitOnly")`。
  自分を担当に指定した行しか作れない。`initialOk` / `validateOk` は既に全経路に効いているので
  そのまま。
- **`itemDelete`** — 今は `!immutable && writerOf`。`scopedWriter && assignedBefore` を or で足す。

`immutable` / `transitions` / `validate` は writer 経路と同じように `assignee` にも効く。
そこは何も足さなくてよい。

---

## 見落としやすい副作用 2 つ

### 1. メールキューが行スコープを取れない

`firestore.rules` の `match /mail/{mailId}` は `writerOf(a, request.resource.data.cid)` で判定
しており、**itemId 単位の絞りをかける形になっていない**（`mailAgainst` はレコードを `get()` して
遷移を再導出するが、認可自体はコレクション単位）。放置すると **`assignee` が承認できても
お客に承認メールが飛ばない**。

選択肢:

- **(a) `scopedWriter` も通す** — ただし「どの行に対しても積める」が残る。宛先と本文は
  `mailAgainst` がレコード側から再導出しているので実害は小さいが、設計ノートが警戒している
  「サロンのドメインから被害者にスパムが飛ぶ」経路と隣接している。**採るならここを別途詰める。**
- **(b) メール積みは owner / editor に残す** — 承認は担当者、通知はオーナー。動くが片手落ち。
- **(c) 遷移をトリガに Functions 側で積む** — 正しいが範囲が大きい。

**初版は (a) で、`mailAgainst` に「自分が担当の行に限る」を足せるか実装時に判断する。**
`srcItem` を既に `get()` しているので、担当フィールドの比較は追加コストなしで書けるはず。

### 2. 客が担当を書き換えうる

S1 は `public.submit.selfUpdate` で、客が pending の間 `stylist` を変更できる想定。
`assigneeField` が客の書き換え可能フィールドだと、**客が「誰に権限が渡るか」を決められる**。
予約アプリとしては正しい挙動だが、意図せずそうなっている場合と区別が付かない。
**publish 時の警告**（拒否ではない）を出す。

---

## 検査（どこで何を拒否するか）

### core（`packages/core/src/collection/server/`）

- `publishManifest.ts` — `APP_ROLES` に `"assignee"` を追加。`CollectionConfigZ` に
  `assigneeField: z.string().trim().min(1).optional()` を追加。この config は
  `publishProject.ts` が `collections: authored.collections` としてそのまま
  `apps/{aid}.collections[cid]` に載せるので、**projection 側の変更は不要**。
- `publishChecks.ts` の `publishProblems` に追加:
  - `assigneeField` が実在する**保存フィールド**を指していること。計算フィールド
    （`derived` / `rollup` / `toggle` / `flag` / `embed` / `backlinks`）はルールが見る生レコードに
    存在しないので、指定すると**永久に fail closed** する。`completionField` について既に同趣旨の
    拒否メッセージがあり、同じ罠。
  - 型は `string` / `email` のみ。
  - `assigneeField` が `public.submit[cid].selfUpdate` のどれかに現れたら**警告**（上記副作用 2）。

### MulmoTerminal（`server/backends/sharedApp/context.ts`）

`declarationProblems` に追加:

- **`assignee` を持つメンバーがいるのに、そのコレクションに `assigneeField` が無い** → 拒否。
  無いとその人は何の権限も持たないまま、**どこにもエラーが出ない**。メールアドレスの大小文字で
  塞いだ `rosterCaseProblems` と同じ形の穴で、同じ場所に置く。
- 逆（`assigneeField` があるが `assignee` が誰もいない）は無害。何も言わない。

---

## 変更範囲

| リポジトリ | ファイル | 内容 |
|---|---|---|
| `../mulmoserver` | `firestore.rules` | `readerOf` / `updateWith` / `createWith` / `itemDelete` + 述語 3 つ。`mail` は上記 (a) |
| | `test/rules/rules_scenarios.ts` | 下記 4 ケース |
| `../mulmoclaude` | `packages/core/.../publishManifest.ts` | `APP_ROLES`, `CollectionConfigZ.assigneeField` |
| | `packages/core/.../publishChecks.ts` | `assigneeField` の検査 |
| | （ホスト側 UI にロール表があれば）| 表示名 |
| ここ | `server/backends/sharedApp/declare.ts` | `APP_ROLE_NAMES` に追加 |
| | `server/backends/sharedApp/context.ts` | `declarationProblems` の追加検査 |
| | `server/skills/mulmoterminal-shared-app/SKILL.md` | ロール表 + `assigneeField` の説明 |
| | `test/server/backends/` | 宣言検査の spec |

---

## 実装順と deploy 順

**ルール → core 公開 → MulmoTerminal。** 逆順にすると、新ロールを載せたアプリを古いルールが
見て `readerOf` にも `writerOf` にも一致せず、その美容師は**全部拒否**になる。安全側に倒れる
（漏れはしない）が、原因の見えない壊れ方をする。

1. `../mulmoserver` にルールと `test/rules/` のケースを入れ、**手動 deploy する**。
   ルールの deploy は CI がなく、deploy 済みかどうかがどのリポジトリにも記録されない
   （mulmoserver #155 のルールを 2026-08-11 に手で deploy したときの教訓）ので、**deploy したことを PR に書く**。
2. core に `APP_ROLES` と `assigneeField` を入れ、publish して版を上げる。
3. MulmoTerminal で core を bump し、`APP_ROLE_NAMES`・`declarationProblems`・SKILL を揃える。

### テスト（`test/rules/rules_scenarios.ts`）

S1 に 4 ケース:

- `assignee` が**自分が担当の**予約を `pending → approved` にできる
- `assignee` が**他人が担当の**予約を承認できない
- `assignee` が予約の担当を**自分に付け替えて**承認することができない（`assignedBefore`）
- `assignee` が**担当を自分にしない** create をできない（`assignedAfter`）

加えて既存の非退行として、`editor`（受付）が全予約を触れること、`assigneeField` を宣言して
いないコレクションで `assignee` が何もできないこと。

---

## 採らなかった案

- **`ownRow` の一般化**（`participant` + `selfUpdate` で表現する）— 一見小さいが、`ownRow` は
  `public.submit` の存在を前提とし、比較先が `emailField`（= 客のアドレス）1 個に固定されている
  ので担当者には使えない。さらに `selfUpdate` は submit 宣言側のキーなので、公開投稿を持たない
  コレクションでは書きようがない。加えて `participant` は全件を読めず、当日のスケジュールが
  見えない。作り込むほど歪む。
- **承認を owner に集約する**（ルール変更ゼロ）— 美容師は `bookings: viewer` にして、
  `pending → approved` はオーナーが行う。小さなサロンなら実運用でこれが正解の可能性は高い。
  **上の作業量に見合うかは「美容師が互いの予約を触れると実際に困るか」次第**であり、
  それが確認できるまでこの計画は着手しない。
- **コレクションを担当ごとに分ける** — ロールで絞れるが、空き枠の計算も一覧も分断される。

---

## 決めていないこと

- メールキュー（副作用 1）を (a) で通すとして、`mailAgainst` に担当一致を足すか。
- 担当替え（`assignedAfter` を緩める宣言）を初版で入れるか。**入れない**前提で書いたが、
  「今日は A が休みなので B に振り替える」は現場で起きる。振替をオーナー/受付の仕事とするか、
  宣言で開けるか。
- `assignee` に delete を与えるか。上では与えているが、`immutable` を宣言していない予約台帳で
  担当者が行を消せてよいかは業務判断。

---

## 実装時に決めたこと（2026-08-12）

計画の未決 3 点と、書いてみて変えた点。

- **`'*': "assignee"` は拒否する。** 計画では触れていなかったが、app 全体のロールにすると
  「どのコレクションでも同じフィールド名が正しい」ことが要求され、欠けているコレクションでは
  *絞りが無い*ではなく*権限が無い*という意味になる。cid を名指しさせる。
- **メールキュー（副作用 1）は (a) を採り、行の絞りも入れた。** `mailAgainst` が既に
  `srcItem` を読んでいるので、`assigneeField` の一致を追加コストなしで見られた。「同僚の予約は
  承認できないが、その客に承認メールは送れる」が残らずに済んだ。
- **担当替えは初版で入れない。** update は変更前・変更後の両方が自分であることを要求する。
  振替はオーナー / 受付（editor）の仕事。
- **`assignee` に delete を与えた**（変更前一致が条件）。`immutable` を宣言すれば止まる。
- **客が `selfUpdate` で担当を書き換えうる件は、警告を出さない。** core の検査は拒否しか
  持たず、警告の経路を作るほどの話ではない。テンプレート（`templates/salon.md`）で
  「意図してやるときだけ」と説明する形にした。
- **スキーマとの突き合わせは MulmoTerminal 側**（`server/backends/sharedApp/scopedFields.ts`）。
  core の `PublishableCollection` がスキーマを持たないのは意図的な境界で、`publicInputProblems`
  が既に同じ分け方をしている。

実装: mulmoclaude#2874（core 3.12.0）/ mulmoserver#162（ルール）/ mulmoterminal 側の PR。
