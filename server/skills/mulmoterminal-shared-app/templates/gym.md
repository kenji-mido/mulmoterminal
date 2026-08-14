# テンプレート: 先着枠と待機（ジムのクラス予約）

**いつ使うか** — 定員があり、**決まった時刻に申込みが開き**、先着で埋まるもの。ジムの
クラス、ワークショップ、面談枠、席の予約。

**最初に利用者へ言うこと**が 2 つあります。作ってから言うのでは遅い:

- **繰り上がりの通知は飛びません。** 画面を開けば「繰り上がりました」と出せますが、
  メールは出せません（下の「繰り上げ」参照）。
- **順位を見るには、参加者が互いの申込みを読める必要があります。** 名前が並んで見えても
  よいか、先に確認してください。

---

## 中心にある考え方 — 定員は「状態」ではなく「順位」

**セキュリティルールは件数を数えられません。** クエリも集計も書けないので、「残り 1 枠」を
サーバ側で守る宣言はどう書いても作れません。

そこで**定員を保存せず、申込み順の順位から導きます**。

- 申込みを `createdAt` 昇順に並べ、**1〜8 番目が確定、9〜10 番目が待機**、それ以降は待機 3…
- **3 番目がキャンセルすると、9 番目は書き込みゼロで 8 番目になります。** 繰り上げという
  操作が自動になるのではなく、**存在しなくなる**。
- 8 時ちょうどに 30 人が殺到しても、全員が自分のドキュメントを 1 件書くだけ。奪い合う
  カウンタが無いので競合しません。溢れても壊れず、11 人目は「待機 3 番」になるだけです。

これを成立させているのが `stampField`（順位を偽装させない）と、表示側の view です。

---

## app.json

```json
{
  "aid": "(init が書きます)",
  "name": "スタジオみどり",
  "slug": "studio-midori",
  "members": {
    "owner@gym.jp": { "*": "owner" },
    "desk@gym.jp": { "bookings": "editor", "classes": "editor" }
  },
  "collections": {
    "bookings": {
      "submitOnly": true,
      "statusField": "status",
      "transitions": { "initial": ["requested"], "requested": ["cancelled"] }
    }
  },
  "public": {
    "enabled": true,
    "read": ["classes"],
    "submit": {
      "bookings": {
        "auth": "verifiedEmail",
        "emailField": "memberEmail",
        "idFrom": "auth.uid+field",
        "idField": "classId",
        "stampField": "createdAt",
        "initialStatus": "requested",
        "createFields": ["classId", "memberEmail", "memberName", "createdAt", "status"],
        "selfTransitions": { "requested": ["cancelled"] },
        "window": { "fromField": { "ref": "classId", "collection": "classes", "field": "opensAt" } }
      }
    }
  }
}
```

## .claude/skills/classes/schema.json

```json
{
  "title": "クラス",
  "icon": "fitness_center",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "title": { "type": "string", "label": "クラス名", "required": true },
    "startsAt": { "type": "datetime", "label": "開始", "required": true },
    "opensAt": { "type": "number", "label": "申込み解禁（epoch millis）", "required": true },
    "capacity": { "type": "number", "label": "定員" },
    "waitlist": { "type": "number", "label": "待機の上限" }
  }
}
```

## .claude/skills/bookings/schema.json

```json
{
  "title": "申込み",
  "icon": "how_to_reg",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "classId": { "type": "string", "label": "クラス", "required": true },
    "memberName": { "type": "string", "label": "お名前", "required": true },
    "memberEmail": { "type": "email", "label": "メール", "required": true },
    "createdAt": { "type": "datetime", "label": "申込日時", "required": true },
    "status": { "type": "enum", "label": "状態", "values": ["requested", "cancelled"] }
  }
}
```

---

## 効いている宣言 5 つ

### `stampField: "createdAt"` — 列に割り込ませない

レコードが**サーバの時刻**を持っていることを create で強制し、以後変更させません。

順位が定員の代わりになる以上、順位の元になる時刻が偽装できると全部が崩れます。
`idFrom` は二重申込みを防ぎますが、**昨日の日付を書いて先頭に並ぶ**のは防ぎません。
スタッフ（editor）にも同じ制約がかかるので、受付が友人を先頭に入れることもできません。

**`createFields` に入れる必要があります**（ルールはリスト外のキーを拒否するため）。
ただし**入力欄としては描かれません** — 公開フォームの射影がこの名前を
`stampField` として別に伝えるので、ページはサーバ時刻のセンチネルを入れます。

キャンセルしても時刻は動きません（更新側は「値が動いていないこと」を見ます）。
動かす仕様にすると、離脱する列の最後尾に飛ばされてしまいます。

### `window.fromField` — クラスごとの解禁時刻

「3 日前の朝 8 時」は**レコードごと**の境界なので、コレクション全体に 1 個の
`window.from` では書けません。

**日付計算はルールにさせません。** `opensAt` に **epoch millis** を入れるのは
クラスを登録する側の仕事で（「3 日前の 8 時」は業務知識、しかもタイムゾーンが要る）、
ルールはそれを読んで `request.time` と比べるだけです。

```
opensAt = (クラスの開始日の 3 日前の 08:00 現地時間).getTime()
```

`collection` は宣言で固定されていて、申込み側から取るのは**ドキュメント ID だけ**です。
クラスが存在しない・`opensAt` が無い場合は、窓が開くのではなく**拒否**されます。

### `idFrom: "auth.uid+field"` + `idField: "classId"` — 1 人 1 枠

ドキュメント ID が `{uid}_{classId}` に固定されます。`allow create` は**存在しない
ドキュメントにしか適用されない**ので、2 回目の申込みはルールが自動で弾きます。
重複チェックのコードは要りません。

### `submitOnly: true` — 水増しを防ぐ

`emailField` で「この人が申し込んだ」という意味を持つレコードになるので、publish が
要求します。代償として**スタッフの代理入力はできません**。

### `selfTransitions` — 本人のキャンセル

`requested → cancelled` だけを本人に許します。キャンセルは delete ではなく状態にして
ください。**view が順位を詰めるときに除外**でき、誰がいつ抜けたかも残ります。

---

## view が描くもの

カスタムビュー（`views/*.html`）が、読めた行から:

1. `status != "cancelled"` を `createdAt` 昇順に並べる
2. 先頭 `capacity` 件を「確定」、次の `waitlist` 件を「待機 N 番」、それ以降も待機として続ける
3. 自分の行を強調して「あなたは待機 1 番です」と出す

定員（8 と 2）は**クラスのレコード**に持たせてあります。クラスごとに変えられ、
ルールは読みません。**これは表示上の定員です** — 9 番目の人が現場に来ることは
止められません。順位方式ではデータが壊れないので、これは不整合ではなく運用の話です。
法的・課金的に厳格な定員が要るアプリには、この形は向きません。

## 繰り上げ

**書き込みが起きないので、通知の起点がありません。**

- 画面を開けば繰り上がりが見える（順位が詰まるだけなので即時）
- **メールは飛ばない**

キャンセルした人の行を起点に待機者へメールを積む形は、宛先が**別のレコードの人**に
なるため、`mail` の安全性の前提（宛先はそのレコードから再導出する）を崩します。
通知が要るなら、今のところ別の仕組み（サーバ側のトリガ）が必要です。

---

## 読み取り権限 — ここだけ先に決める

順位は**読めた行からしか計算できません**。

| 形 | 順位が見えるか | 代償 |
|---|---|---|
| 会員を名簿に載せる（`participant` + `peerVisibility: "public"`） | 見える | **参加者の名前が互いに見える** |
| 名簿に載せず公開投稿だけ | **見えない**（自分の行しか読めない） | 自分が何番目かも分からない |

ジムは会員制なので前者が自然ですが、**先に確認してください**。

参照: [SKILL.md](../SKILL.md)、担当者が承認する形は [salon.md](./salon.md)。
