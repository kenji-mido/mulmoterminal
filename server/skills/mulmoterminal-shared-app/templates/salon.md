# テンプレート: 予約と承認（美容室）

**いつ使うか** — 申込みを受けて、**担当者が自分の分だけ承認する**アプリ。美容室の予約、
面談の申込み、修理の受付、査読の割り当て。「誰が担当か」で権限が変わるものはこの形。

要点は 2 つあります。

**`assignee` ロール。** 担当者は**全予約を見て、自分の担当だけ書き換えられる**。受付は
全予約を書き換えられる。この 2 つを同時に表現できるのは、絞りがコレクションではなく
**名簿の側**にあるからです。

**枠（`slots`）を実在させ、予約の id を枠の id にする。** これで「同じ枠を 2 人が取る」が
起きなくなります。2 人目の書き込みは**既に在るドキュメントへの書き込み**になり、公開の
申込み経路は create しか許していないので拒否される。ジム（[gym.md](./gym.md)）の
先着順とは違う仕組みで、あちらは「数えられないので順位で見せる」、こちらは
**数える必要がない**（枠は 1 行）。

---

## app.json

```json
{
  "aid": "(init が書きます。手で触らないこと)",
  "name": "さくら美容室",
  "slug": "sakura-hair",
  "members": {
    "owner@salon.jp": { "*": "owner" },
    "reception@salon.jp": { "bookings": "editor", "slots": "editor", "services": "viewer" },
    "anna@salon.jp": { "bookings": "assignee", "slots": "viewer", "services": "viewer" },
    "ben@salon.jp": { "bookings": "assignee", "slots": "viewer", "services": "viewer" }
  },
  "collections": {
    "bookings": {
      "submitOnly": true,
      "assigneeField": "stylistEmail",
      "statusField": "status",
      "transitions": {
        "initial": ["pending"],
        "pending": ["approved", "rejected"],
        "approved": ["cancelled"]
      },
      "mail": {
        "toField": "customerEmail",
        "on": { "booking-approved": { "from": ["pending"], "to": "approved" } }
      }
    },
    "slots": { "mirrorOf": "bookings" }
  },
  "public": {
    "enabled": true,
    "read": ["services", "stylists", "slots"],
    "view": { "path": "views/booking.html", "collections": ["stylists", "services", "slots"] },
    "submit": {
      "bookings": {
        "auth": "verifiedEmail",
        "emailField": "customerEmail",
        "createFields": ["customerName", "customerEmail", "service", "slot", "status"],
        "initialStatus": "pending",
        "idFrom": "field",
        "idField": "slot",
        "idIn": { "collection": "slots", "where": { "field": "state", "equals": "open" } },
        "mirror": "slots",
        "window": {
          "fromField": { "ref": "slot", "collection": "slots", "field": "opensAt" },
          "untilField": { "ref": "slot", "collection": "slots", "field": "closesAt" }
        },
        "selfUpdate": { "pending": ["service"] },
        "selfTransitions": { "pending": ["cancelled"] }
      }
    }
  }
}
```

**申込みの宣言は丸ごと書いてください。** `idFrom` と `idField` だけを書いた短い版は
**publish が拒否します**（`idIn` が無ければ、実在しない枠の予約が黙って通るので）。
省略が効くところではありません。

## .claude/skills/bookings/schema.json

```json
{
  "title": "予約",
  "icon": "event",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "customerName": { "type": "string", "label": "お名前", "required": true },
    "customerEmail": { "type": "email", "label": "メール", "required": true },
    "service": { "type": "enum", "label": "メニュー", "values": ["カット", "カラー", "パーマ"], "required": true },
    "slot": { "type": "string", "label": "枠", "required": true },
    "stylistEmail": { "type": "email", "label": "担当（アドレス）" },
    "stylist": { "type": "ref", "label": "担当", "to": "stylists" },
    "status": { "type": "enum", "label": "状態", "values": ["pending", "approved", "rejected", "cancelled"] }
  }
}
```

## .claude/skills/slots/schema.json

```json
{
  "title": "枠",
  "icon": "schedule",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "stylist": { "type": "ref", "label": "担当", "to": "stylists" },
    "startAt": { "type": "datetime", "label": "開始", "required": true },
    "opensAt": { "type": "number", "label": "受付開始（epoch millis）", "required": true },
    "closesAt": { "type": "number", "label": "受付締切（epoch millis）", "required": true },
    "state": { "type": "enum", "label": "状態", "values": ["open", "taken"], "required": true }
  }
}
```

**主キーは合成スラッグ**にします（`anna-2026-09-01-1000` のような）。予約の id が
この id になるので、読める形にしておくと運用が楽です。

`opensAt` / `closesAt` は **epoch millis の数値**で、枠を作るときに計算して入れます。
ルールに日付の計算はできず `request.time` は UTC なので、「3 日前の朝 7 時」のような
決め方をするのは枠を作る側の仕事です。ルールは**比べるだけ**。

`state` は予約と**同じ書き込みで**動きます（下記）。手で書き換えるものではありません。

`stylists` / `services` は普通のコレクション（`storage: {"type":"firestore"}` だけ足す）。
担当者一覧、メニューと所要時間です。

## views/booking.html

**リポジトリの root から見た `views/` に置きます**（`app.json` と同じ場所を起点に、
`views/<name>.html` の 1 枚だけ）。ホスト側のカスタムビューとは**別の契約**です —
`__MC_VIEW` を読むビューをここに指すと publish が拒否します。

```html
<div id="grid"></div>
<script>
  const view = window.__MC_PUBLIC_VIEW;
  view.onState(({ stylists = [], slots = [] }) => {
    const open = slots.filter((slot) => slot.state === "open");
    document.getElementById("grid").innerHTML = open
      .map((slot) => `<button data-slot="${slot.id}">${slot.startAt} ${slot.stylist ?? ""}</button>`)
      .join("");
  });
  document.addEventListener("click", async (event) => {
    const slot = event.target.dataset?.slot;
    if (!slot) return;
    const result = await view.submit("bookings", { slot, customerName: prompt("お名前") ?? "", status: "pending" });
    if (!result.ok) alert("その枠は取られました");
  });
  view.ready();
</script>
```

3 つだけ守れば形は自由です。

- **`ready()` を最後に呼ぶ。** これが「listener を張り終えた」の合図で、親はこれを
  待ってからデータを送ります。呼ばないとデータは永久に来ません
- **`submit()` の結果を見る。** 「その枠は取られました」を出せるのはここだけです。
  親が書き込みを行い、ルールが判断し、答えが返ってきます
- **`customerEmail` は送らない。** サインインした訪問者のアドレスを親が入れます
  （ルールがトークンと突き合わせるので、入力欄にすると間違えられるだけの欄になります）

**押した瞬間には書き込まれません。** 親が送られてきた値を iframe の外に描いて確認を
取り、訪問者が押してから書きます。これはビューの HTML が信頼されていないためで、
読み込んだ瞬間に `submit()` を呼ぶページがあっても、勝手に予約が入ることはありません。

---

## 利用者に先に言っておくこと

- **公開されるのは `slots` だけ**で、予約そのもの（氏名・メール）は公開されません。
  Firestore の読み取りはドキュメント単位でフィールドを隠せないので、これは運用の
  注意ではなく**構造**で守っています。`bookings` を `public.read` に足すと、その瞬間に
  客の連絡先が匿名の訪問者から全部読めます
- **枠は先着で本当に排他されます。** ジムの順位方式と違い、繰り上げは起きません
- **顧客がキャンセルしても枠はすぐには空きません。** 受付が戻す操作が要ります（下記）

---

## なぜこの形か — 迷いやすい 7 点

### 1. 担当は `stylistEmail`（アドレス）で、`stylist`（ref）ではない

ルールが比較できるのは `request.auth.token.email` だけです。`ref` が保存しているのは
**参照先の主キー slug**（`anna`）であってアドレスではないので、`assigneeField` に ref を
指定すると誰にも一致しません。`check` が拒否します。

**両方持つのが正解**です。`stylist`（ref）は画面に出す用、`stylistEmail` は権限用。
`stylists` コレクションの主キーをアドレスにすれば 1 本で済みますが、公開ページに
スタッフのアドレスが出るので勧めません。

### 2. 担当を割り当てるのは受付（editor）で、客ではない

`createFields` に `stylistEmail` を入れれば「客が担当を指名する」形にできますが、
それは**客が「誰にこの行の権限が渡るか」を決める**ということです。予約アプリとしては
自然な要求なので禁止はしていませんが、意図してやるときだけにしてください。

初期状態では `stylistEmail` が空で、受付が入れるまで誰の担当でもありません。
その間 pending の予約を承認できるのはオーナーと受付だけです。

### 3. `submitOnly: true` を外せない — その代わりスタッフの代理入力ができない

`emailField` を宣言した時点で、そのレコードは「この人が申し込んだ」という意味を持ちます。
`submitOnly` はそれを守るもので、**publish が要求します**（無いと owner / editor が誰の
名前でもレコードを作れてしまう）。

代償として、**電話予約をスタッフが代わりに入力することはできません**。どうしても必要なら
`emailField` を外すことになり、そのとき失うのは「マイ予約」ページ（客が自分の予約を見て
キャンセル・変更する）です。どちらを取るかは店の判断で、コードの都合ではありません。

### 4. 承認は状態機械が縛る — 担当者も例外ではない

`transitions` は writer 経路にも効きます。`cancelled` の予約をいきなり `approved` に
飛ばすことは、受付にもオーナーにもできません。`approved` になれるのは `pending` からだけ。

### 5. 承認メールは担当者も出せる、ただし自分の担当の分だけ

`mail` は「宣言した遷移が実際に起きたとき」にだけ積めます。宛先も本文もレコードから
再導出されるので、担当者が選べるのは**どのレコードか**だけで、そこにも同じ絞りが
かかっています。

### 6. 枠は予約と**同じ書き込みで**取られる

予約が作られるとき、`slots` のその行の `state` も同じ batch で `taken` になります。
ルールが**両側から**要求するので、片方だけの書き込みは通りません:

- 鏡を連れない予約の create は拒否される（＝予約は成立しているのに公開ページが
  「空き」と言い続ける、が起きない）
- `state` に書ける値は**真実だけ**です。予約が在れば `taken`、無ければ `open`。
  嘘は書けないので、この 1 フィールドは**誰でも**書けます

最後の点が効くのは、**先を越された 2 人目**です。その人は「取られていた」と知った
唯一の人なので、拒否のあと自分で `taken` に直せます。格子はそこで正しくなります。

公開ページの表示は**遅れることがあります**（鏡は写しなので）。ただし遅れる方向は常に
「空きと言っているが実は埋まっている」で、その先には id の衝突による拒否が必ず待って
います。**見た目が遅れるだけで、二重予約は起きません。**

### 7. キャンセルは 2 段階 — 客の操作では枠は空かない

| 誰が | どうやって | 枠は |
|---|---|---|
| 顧客 | `selfTransitions` で `status: "cancelled"` | **空かない**（ドキュメントが残り id を占有し続ける） |
| 受付・担当 | 予約を delete（`slots` を `open` に戻す書き込みと対で） | 空く |

顧客に delete はできません（`itemDelete` は writer と自分の担当行を持つ `assignee` だけ）。
**これは制約であると同時に、たぶん正しい運用でもあります** — 枠が客の操作で即座に他人に
開く必要はなく、受付が確認してから戻す方が店の実態に合う。ただし**そう決めたことを
利用者に言ってください**。「キャンセルしたのに枠が空かない」は、書いていなければバグに
見えます。

---

## 担当者に何ができて、何ができないか

| | オーナー | 受付 (editor) | 担当 (assignee) |
|---|---|---|---|
| 全予約を**読む** | できる | できる | **できる**（当日の全体が見えないと働けない） |
| 自分の担当を承認 | できる | できる | **できる** |
| 他人の担当を承認 | できる | できる | **できない** |
| 担当を付け替える | できる | できる | **できない**（自分に付け替えて奪うのも、他人に投げるのも） |
| 予約を消す | できる | できる | 自分の担当だけ |
| 枠・メニューを編集 | できる | **枠は編集できる**（受付が枠を作り、戻す） | 読むだけ |
| publish | **できる** | できない | できない |

`assignee` は**コレクションを名指しして**与えます。`{"*": "assignee"}` は拒否されます —
「自分の行」が何を指すかはコレクションごとに違うためです。

---

## 作る順番

1. `init`（`slug` に店の名前）
2. `stylists` / `services` / `slots` / `bookings` のスキル + スキーマを書く
3. `views/booking.html` を書く（**リポジトリの root から** `views/`。スタイリスト × 時間の
   格子。埋まっている枠は選べない）
4. `check` — ここで `assigneeField` の型、ロールの過不足、鏡の片側落ち、ビューが読むと
   宣言したコレクションが `public.read` に無いこと、が出ます
5. `deploy` → 名簿の人に URL を渡す
6. スタッフを `invite`（担当者は `role: "assignee"` と `cid: "bookings"`）
7. 枠を作る（`opensAt` / `closesAt` / `state: "open"` を入れて `slots` に流し込む）
8. 客に開くときだけ `publish`

**排他に関わるキーは、レコードが 1 行でもあると変えられません**（`idFrom` / `idField` /
`idIn` / `mirror` / `mirrorOf`）。publish が拒否し、`confirm` でも通りません — 変えると
過去の予約が「押さえていたはずの枠」を押さえなくなり、しかも**誰にも見えない**ためです。
やり直すなら、コレクションを空にするか新しい cid で作ります。7 の前に 3〜4 を済ませる
順番はそのためです。

参照: [SKILL.md](../SKILL.md) の「公開するとき」、先着順の申込みは
[gym.md](./gym.md)。
