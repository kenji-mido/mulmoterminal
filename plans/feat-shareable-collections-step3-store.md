# feat: 共有コレクション — 実装順 3「store を `(aid, cid)` で書き直す」

**Status**: **完了 — mulmoclaude #2856 マージ済み（core 3.6.0）**。
次のステップは [`feat-shareable-collections-step5-publish.md`](./feat-shareable-collections-step5-publish.md)。
このファイルは着手する人への引き継ぎとして書かれ、いまは #2856 の設計記録も兼ねる。
**日付**: 2026-08-10（#2856 の進行に合わせて更新）
**親プラン**: [`plans/feat-shareable-collections.md`](./feat-shareable-collections.md) — **先に読むこと。**
このファイルは親プランを前提に、ステップ 3 だけを切り出したもの。

**作業リポジトリ**: `../mulmoclaude`（`@mulmoclaude/core`）。**MulmoTerminal のコードは 1 行も変わらない。**
MT 側の作業は実装順 4 以降で、core の publish が前提になる。

---

## いま何が済んでいるか（前提。やり直さないこと）

| | 何が | どこに |
|---|---|---|
| 実装順 1 | **`CollectionKey`**（`(root, slug)` と `(aid, cid)` の判別共用体）と、それで鍵を持つ change payload / 完了ベル id | mulmoclaude #2855 **マージ済み**、core **3.5.0** |
| 実装順 2 | **Firestore ルール**（`apps/{aid}` 階層、members による認可、投稿制約、mail キュー）と **emulator ユニットテスト** | mulmoserver #155 **マージ済み** |

**ルールは動作確認済みである。** 静的レビュー 4 巡が通していたルールは、実際には
1 リクエスト 1000 式の評価上限に達して**1 つも実行できなかった**。現在のルールは
emulator で実行されたもので、`../mulmoserver/firestore.rules` が正。
親プラン本文のルールのコードブロックは**動かない初稿**なので参照しないこと。

### core が既に提供しているもの（`@mulmoclaude/core/collection` / `/collection/server`）

```ts
type CollectionKey = { kind: "local"; root: string; slug: string }
                  | { kind: "shared"; aid: string; cid: string };

sharedCollectionKey(aid, cid)      // 検証つきコンストラクタ。名前は SAFE_SLUG_PATTERN
localCollectionKey(root, slug)     // server 側。root を canonicalRoot で正規化する
collectionKeyName(key)             // slug または cid。**同一性ではない**（スコープ内の索引用）
collectionKeyId(key) / parseCollectionKeyId(s) / sameCollectionKey(a, b)
isValidCollectionName(value)       // 鍵を経由しない符号化器が同じ規則を使うための述語

// 変更通知
sharedCollectionChangePayload(base, aid)   // shared 用。root は絶対に付かない
collectionChangePayload(base, root)        // local 用。aid を受け付けない（型で排他）
collectionChangeKey(payload, fallbackRoot) // 「フィールドが無いことの意味」を決める唯一の場所
```

**この型が名前の許容文字の単一の出所である。** 下流の符号化（完了ベル id、pubsub
チャンネル名）は独自の規則を持たないこと — 層が食い違うと、片方だけ通って
publisher の catch に飲まれ、**ライブ更新が理由も告げずに止まる**（実際に起きた）。

---

## このステップで作るもの

**`storage: { type: "firestore" }` を宣言したコレクションのレコードを、
`apps/{aid}/collections/{cid}/items/{id}` に読み書きする `CollectionStore` 実装。**

- **スキーマとビューは git**、**レコードだけ Firestore**（親プラン D3）
- コレクションの同一性は `(aid, cid)`。`cid` はコレクションの slug、`aid` は
  **アプリ（= リポジトリ）単位**の id
- `onSnapshot` によるライブ更新は**このステップではやらない**（実装順 6）。
  今は「変更を報告できない store」として watcher の clock tick に拾わせる
- publish（git → Firestore）も**やらない**（実装順 5）

---

## 出発点: ドラフト PR mulmoclaude #2209

`feat/firestore-collection-backend`（2026-07-28、25 ファイル +1571 −50）。
**そのままマージしてはいけない**が、機構は 1 つも捨てるところがない。

### そのまま使える（パスに依存しない設計）

| ファイル | 何が使えるか |
|---|---|
| `packages/core/src/collection/server/firestoreDocs.ts` | **SDK との継ぎ目**。`collectionPath` は引数なので `(aid, cid)` 化の影響ゼロ。`orderBy("__name__")`（ドキュメント id 順）にする理由 — フィールド順だと**そのフィールドを持たない文書が黙って落ちて部分読み取りになる** — と、`create` が原子的で「2 つの並行 create が両方 missing を観測する」を防ぐこと |
| `firestoreStore.ts` の本体 | レコード変換の fail-soft、`safeRecordId` を他バックエンドと共有する理由（可搬性・ファイルへの書き戻し）、**「未接続」と「0 件」を絶対に混同させない**可用性方針（factory は throw せず各メソッドが実行可能な文言で失敗する）、`query` を持たない理由付け |
| `collection-watchers/watcher.ts` の追加分 | `cannotReportChanges()` が「バックエンドではなく**能力**を問う」形。実装順 6 で `watch` が生えれば**このファイルを触らずに**特別扱いが消える |
| `collection/server/discovery.ts` の `acceptStorageSchema()` 抽出 | 「ファイル backed だけが `storageFile` を解決・containment 検査する」構造 |
| `collection/server/host.ts` の accessor 分離 | `setFirestoreAccessor` を `configureCollectionHost` と分ける理由（セッションは起動時に存在せず、切断で消えるので一発の binding に入れられない） |
| テスト 3 本（store contract / watcher / manageCollection） | インメモリ fake を継ぎ目に注入する形。パスとハンドルの組み立てだけ直せば効く |

### 書き換えるもの

| 箇所 | #2209 | このステップ |
|---|---|---|
| パス | `users/{uid}/collections/{slug}/items` | **`apps/{aid}/collections/{cid}/items`** |
| 同一性の出所 | uid は**ライブセッションから。スキーマからは絶対に取らない** | **`aid` はリポジトリにコミットされる**（意図的） |
| 安全論拠 | 「スキーマ由来のパスは rules の守備範囲外を指せる」 | **members による認可**（マージ済みルール） |
| 削除の拒否文言 | 「孤児になるので拒否」 | 理由は同じだが出口がある（オーナーの再帰削除、親プラン参照） |

> **最大の作業はコードではなく理由の書き換えである。** #2209 の安全論拠は
> `firestoreStore.ts` / `host.ts` / `schemaZ.ts` / `discovery.ts` のコメント全部に
> 埋まっている。パスの計算は 1 行だが、**「パスを指定させないことで守る」から
> 「名簿で認可する」への入れ替えは全ファイルに及ぶ。** 古い論拠を残したまま
> パスだけ変えると、次に読む人は嘘を読むことになる。

---

## 決まっていること（蒸し返さない）

1. **`aid` はアプリ（リポジトリ）単位であって、コレクション単位ではない。**
   したがって `StorageZ` の firestore バリアントは `{ type: "firestore" }` のままでよく、
   `aid` を per-collection スキーマに載せない。親プラン D1「共有の単位はアプリ」の帰結
2. **`.strict()` を firestore バリアントに付ける**（#2209 の判断を維持）。
   このバリアントはパスを取らないので、`path` を書いた人の誤解を黙って通してはいけない。
   sqlite 側は既存スキーマを壊さないため permissive のまま
3. **`safeRecordId` は他バックエンドと共有する。** Firestore はもっと緩い id を通すが、
   レコードはバックエンド間で可搬でなければならない
4. **`query` は持たない。** 集計はエンジン側の `runCollectionQuery` が答える
5. **「未接続」を空の結果に縮退させない。** 沈黙は「レコードが無い」と区別できず、
   データ消失に見える

## 決まっていること（続き — 2026-08-10 に着手時点で判断した 3 点）

5. **`aid` は core の最小ローダが `<root>/app.json` から読み、`discovery` が解決して
   `LoadedCollection` に載せる。ホストの binding では渡さない。** store は解決済みの
   `(aid, cid)` だけを受け取り、`app.json` を自分では読まない。

   - **binding は MT で構造的に壊れる。** MT の server プロセスは複数のプロジェクトルートを
     同時に扱うので、プロセスグローバルな `aid` はどのリポジトリのコレクションも同じアプリに
     向ける。`aid` はリポジトリにコミットされる（D1）＝**コレクションの位置の属性**であって、
     セッションの属性ではない
   - **既に同じ形が discovery にある。** `acceptStorageSchema()` が `storageFile` を
     解決・containment 検査するのと同じ場所・同じ失敗経路。`app.json` が無い / `aid` が無いなら
     `{ ok: false, reason }` でスキーマを拒否する — **discovery 時の設定エラー**であって、
     実行時の空結果ではない（「未接続を空に縮退させない」の延長）
   - **同一性は 1 回だけ解決する。** store が毎操作で `app.json` を読む形にすると、
     キャッシュ・mtime・失敗時の縮退という判断が store の中に生え、全部間違う方向に倒れる
   - 読むのは `aid` 1 フィールドだけ。`members` / `public` には触らない（実装順 5 の publish の仕事）。
     **authored な `app.json` と published な `apps/{aid}` は別物**（親プラン参照）
   - **`aidEnv`（D6 の worktree 分岐）はこのステップでは実装しない。** 解決が
     `loadAppManifest` 1 箇所に閉じているので実装順 7 はそこだけを書き換えればよい。
     そのとき入れるのは**ホストが渡す resolver フック**であって `process.env` の直読みではない
     — `worktreeEnv` の値は MT がセッションに注入するもので、server プロセスの環境には無い

6. **`FirestoreHandle` から `uid` を落とし、`{ docs; email }` にする。**
   アクセサは「検証済み email でサインイン済み」でなければ null を返す。

   - パスに `uid` が現れなくなった以上、**残せば必ずパスを再導出する**
   - マージ済みルールが認可に使うのは `request.auth.token.email`（`listed()` の `members` は
     email 鍵）。**`uid` は 1 度も評価されない。** 認可に使われない値を認証の証拠として持つと、
     次の読み手はそれを認可の一部だと読む
   - `email` を持つ実益は失敗文言。`permission-denied` は共有コレクションで最も出る失敗なのに
     最も情報が無い。「`a@b.jp` としてサインインしています — このアプリの members に
     含まれていない可能性があります」と言える
   - **匿名申込を許さない**（下記）ので、principal は常に検証済み email。
     親プランの認証段階 B（匿名認証、uid ベースで自分の申込みを見る）は採らないため、
     `uid` ベースの同一性はどこにも要らない

7. **`cid` は常に slug と同じ。スキーマに `cid` キーは持たせない。テストで固定する。**

   - スキーマ・ビュー・skill テキストはディスク上で slug 名のディレクトリにある（D3）。
     `cid ≠ slug` を許すと同じコレクションがディスクと Firestore で 2 つの名前を持ち、
     対応表が要る。`collectionKeyName()` が「索引用であって同一性ではない」と警告している罠を
     わざわざ 2 倍にする形
   - firestore バリアントは `.strict()`（決定 2）。そこに `cid` を足すのは
     「位置を宣言させない」という論拠に自分で穴を開けること
   - **ただし「改名したければディレクトリを改名すればよい」ではない。** 下記
   - 文字集合は既に整合している。`slug` は `safeSlugName` を通っており、
     `sharedCollectionKey` の `namePart` が使う `SAFE_SLUG_PATTERN` と同じ規則。
     Firestore のドキュメント id としても安全（`.` / `..` / `/` を含まない）
   - **親プランのキー一覧（「この計画が新規に提案するキー」）は `storage.type: "firestore"` + `cid`
     と書いていたが、これは決定 1 より前の stale な記述。** 同じ PR で修正した

## 改名 — 共有レコードを持つコレクションの slug は不変

`cid == slug`（決定 7）の帰結。ディレクトリを改名すると**コレクションの同一性が変わる**ので、
`apps/{aid}/collections/<旧 slug>/items` のレコードはそこに残り、改名後のコレクションは
**空に見える**。Firestore にドキュメントの move は無く、ルールにも別名の仕組みは無い。

> **共有レコードを 1 件でも持つコレクションの slug は不変とする。**
> 空のうち（publish 前・レコード 0 件）は自由に改名してよい。

改名がどうしても要るなら、それは**コピーと削除**であって rename ではない:
新しい slug のコレクションを作り、旧 `cid` の items を読んで新 `cid` に書き、旧を消す。
クライアントから可能かは**コレクションの宣言で決まる**（マージ済みルール）:

| 宣言 | 移行できるか | ルール上の理由 |
|---|---|---|
| 素の共有コレクション | できる | writer は create も delete も通る |
| **`submitOnly: true`** | **書き込めない** | `createWith` の writer 分岐が `!submitOnly` で閉じている — 投稿経路を通っていないレコードを作らせないため |
| **`immutable: true`** | **消せない** | `itemDelete` が `!immutable` を要求する |

**これは制限ではなく設計そのものである。** `submitOnly` と `immutable` は
「捏造できない」「改竄できない」を担保するために入れた。移行が通ってしまうなら、
どちらの保証も成立していない。したがって**議会投票やアンケートのように記録の完全性を
宣言したコレクションの slug は、レコードが 1 件でもあれば永久に不変**。

ルールを緩めて移行を通す案は採らない（緩めた瞬間に上の 2 つの保証が消える）。
オーナーが本当に必要とするなら、それは**再帰削除でアプリごと畳んで作り直す**操作であり、
親プランの削除手順に属する。

## 匿名申込は許さない（オーナー判断、2026-08-10）

親プランの認証段階 A（`auth: "none"` 完全匿名）と B（`auth: "anonymous"`）は**採らない**。
公開投稿は常に段階 C（`verifiedEmail`）。

**ルールは変えない。** ルールは 3 段階すべてを表現できる状態でデプロイ済みで、cross-repo の
凍結インフラ。段階をルールから削ると、商売判断が変わったときに cross-repo デプロイをやり直す
ことになる。**この制約は宣言側の不変条件**として、publish の事前検証（実装順 5）と
リンター（実装順 18）が `auth` に `"none"` / `"anonymous"` を書いたアプリを拒否する形で置く。

このステップ（3）はレコードの読み書きだけなので、ここで実装するものは無い。効いてくるのは
決定 6（`uid` を落とす）の後押しと、実装順 5 / 12 / 18。

---

## 検証

**この repo のテストは API キー無し・ネットワーク無しで走らなければならない。**
`FirestoreDocs` の継ぎ目にインメモリ fake を注入する #2209 の形をそのまま使う。

- **store contract テスト** — fake に対して list / get / set / create / delete の
  ラウンドトリップ。`create` が既存 id に対して false を返すこと（原子性の契約）
- **パスのテスト** — `(aid, cid)` から組み立てたパスが
  `apps/<aid>/collections/<cid>/items` であること。**`aid` や `cid` に不正な名前が来たら
  `sharedCollectionKey` が投げること**（鍵を経由しない組み立てを作らない）
- **可用性のテスト** — セッション無しで各メソッドが「未接続」で失敗し、
  **空配列を返さない**こと
- **変更通知のテスト** — 書き込みが `sharedCollectionChangePayload` を発行し、
  `collectionChangeKey` が `{kind:"shared", aid, cid}` を返すこと。
  **root が絶対に載らないこと**（このペイロードはブラウザ、さらにビュー経由で
  LLM 生成の iframe に届く）
- **ルールとの整合** — このステップはルールを変えない。もしルール変更が要ると思ったら、
  それは設計が親プランから外れた合図。**先に立ち止まって確認すること**
  （ルールは cross-repo のデプロイで、凍結インフラ）

コマンド。**どのディレクトリで走らせるかで別のスイートが走る**ので、明示する
（`<mulmoclaude>` は `../mulmoclaude` の絶対パス）:

```bash
# core パッケージ
cd <mulmoclaude>/packages/core && yarn test && yarn typecheck && yarn lint && yarn build

# mulmoclaude のリポジトリルート（ホスト側のテストとバージョンゲート）
cd <mulmoclaude> && yarn test
cd <mulmoclaude> && yarn run test:coverage
cd <mulmoclaude> && yarn run check:launcher-sync
cd <mulmoclaude> && node scripts/packages/check-changelog-ships.mjs
```

**`yarn test` が通っても `test:coverage` は落ちうる。両方走らせること。**
2 つはテストファイルの glob が違い（`test:coverage` は 3 階層目を含まない）、
プロセスの分け方も違うので、**片方だけが拾う失敗がある**。実際 #2856 で、
共有ベルの assert が古い root ベースの helper を参照したままになっていた問題は、
`yarn test` では通り `test:coverage` で初めて出た。CI は両方を走らせる。

**最後の 2 つは core の version を上げた瞬間に落ちる CI ゲート**で、直し方が違う:

- `check:launcher-sync` — `packages/mulmoclaude/package.json` と
  `packages/plugins/google-plugin/package.json` の `@mulmoclaude/core` レンジを
  新しい version に合わせる
- `check-changelog-ships.mjs` — `docs/CHANGELOG.md` の **`[Unreleased]` の
  `Ships` 行**を直す。**公開済みのバージョン節を書き換えてはいけない**
  （出荷していないバージョンを歴史に書くことになる）

## 範囲外

- `onSnapshot` によるライブ更新（実装順 6）
- publish（git → Firestore。実装順 5）
- discovery の 2 ソース化・skill materialize（実装順 4）
- 招待 UI / メンバー管理（実装順 8）
- MulmoTerminal 側の配線（core の publish 後）

### 済み: 共有コレクションの完了ベルを `(aid, cid)` で鍵にする

**mulmoclaude #2856 の `255630a0` で実装され、main にマージ済み。**
（この節は一時「未マージの #2856 に入っている」と注意書きがあった。マージされたので外した。
**このファイルの「済み」は「main にマージ済み」を意味する。**）

以下は、なぜ一度は持ち越そうとしたかと、結局どう決めたかの記録。

**決めた規則: 共有ベルを退役させてよいのは、そのアプリのコレクションを
このホストで解決できる sweep。** 「誰が実行しているか」ではなく**判定に何が必要か**から
導いた — 共有ベルを判定するにはそのレコードを読む必要があり、アプリを持たないホストは
全部の検査が「消えている」と読んで、見たこともないアプリのベルを消す。
`isStaleEntry` が解決結果の `appId` を突き合わせ、一致しないものには手を出さない
（**同名のローカル `tasks` が共有の `tasks` を退役させることも防ぐ** — slug は同一性ではない）。

adapter の契約（`buildNavigateTarget` / `buildPluginData`）は変えていない。
共有のときは root を渡さない — 義務はチェックアウトではなくアプリに属し、
ナビゲーションはどちらにせよ slug で解決する。学習が必要だったのは**同一性だけ**。

以下は当初の見送り理由（記録として残す）:

現状、共有コレクションのベル id は `completionLegacyId(slug, itemId, root)` で作られる
（`aid` の引数はあるが誰も渡していない）。MulmoClaude は単一ワークスペースなので `root` は
`undefined`＝従来どおりの素の id になり、**今日の挙動は壊れていない**。壊れるのは
**MT が同じアプリを 2 つのプロジェクトルートにクローンしたとき** — 同じ
`(aid, cid, itemId)` がチェックアウトごとに別のベルを生む。

**なぜここで直さないか。** 直すには `sweepVerdict` が決めていない設計判断が要る。今それは
`aid` を持つエントリを**必ず `skip`** する（「共有のベルを退役させてよいのは共有の watcher
だけ」）ので、id だけ `aid` 付きに変えると、実装順 3 で入れた
「`completionField` を消したらベルが消える」が**静かに効かなくなる**。
決めるべきは「**どのホストが共有ベルを退役させてよいか**」で、これは親プランが持つ判断。
プランから外れる変更を単独で入れないという、このプランの規律に従って持ち越す。

**やるとき**（実装順 7 = MT の配線 / worktree の `aid` 分岐と同じ回が自然）:

1. `sweepVerdict` に共有の分岐を入れる — そのアプリのコレクションをディスクに持つホストが
   判定してよい、という規則にする（`isStaleEntry` は slug をディスクで解決するので、
   持っていないホストが判定すると生きたベルを消す）
2. `reconcileItem` / `reconcileAllItems` が `collection.appId` を
   `completionLegacyId` の `aid` に渡す（`root` とは排他。id 側は既に throw で守っている）
3. `buildNavigateTarget` / `buildPluginData` は adapter の契約なので**署名を変えない** —
   共有のときは `root: undefined` を渡す。契約変更は MT のポートを伴う

## 落とし穴（このプランの過去の巡回で実際に起きたもの）

- **静的レビューは「読む限り正しく見える」を止められない。** 実装順 2 のルールは
  4 巡の静的レビューを通り、それでも実行できなかった。**動かして確かめること**
- **`assertFails` / エラーは「安全」の証拠にならない。** 評価エラーでも fail する。
  すべての拒否に**対になる成功ケース**を書くこと。無いと「全員に対して壊れている」が
  「安全」と読める
- **層ごとに独自の検証規則を書かないこと。** 名前の規則は `isValidCollectionName` が
  単一の出所。独自規則は、片方だけ通って catch に飲まれ、静かに機能が止まる
