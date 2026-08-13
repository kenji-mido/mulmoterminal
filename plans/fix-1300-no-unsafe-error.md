# fix(lint): `no-unsafe-*` 5 ルールを error にする (#1300 完了)

残り 53 件（本物）を 0 にして、5 ルールを **error** で常設した。

| | before | after |
|---|---|---|
| 本物の `any` | 53 | **0** |
| 型が解決できない偽陽性 | 55 | 58（除外） |

## 「`.vue` を除外」だけでは足りなかった

当初の見立ては「SFC の型が解決できないので `.vue` を除外すれば良い」だった。**それでは CI が
赤いままになる。**

偽陽性は `.vue` に限らず、**`.vue` から型やコンポーネントを import している `.ts`** にも出る。

| ファイル | import 元 |
|---|---|
| `src/main.ts` | `App.vue` |
| `src/plugins-registry.ts` | `CollectionCardView.vue` |
| `src/composables/collectionUi.ts` | `PinToggle.vue` |
| `src/components/filesPaneStore.ts` | `FilesPaneState` from `FilesPane.vue` |

除外リストにはこの 4 つも入れ、**どの `.vue` を import しているか**を各行に書いた。新しく同じ
ことをするファイルが出たらここに足す（型プログラムが SFC を理解するようになったら削除できる）。

## 分類の正規表現を間違えていた

途中まで偽陽性を `could not be resolved|error typed value` で数えていたが、eslint は
`of type error` や `error typed assigned` とも書く。**取りこぼしていたぶんが「本物」に混ざって
いた**ので、`could not be resolved|cannot be resolved|error typed|of type error` で数え直した。

## `fetchJson<T>` — 呼び出し側が名乗った型を検証せず返していた

`src/utils/fetchJson.ts` は**この repo のファイル**（gui-chat-protocol のものではない）。
`read: (raw: unknown) => T` を**必須引数**にした。`wikiApi` の `getJson` が既に使っている形。

- **`useShortcuts`** — 自前のエンドポイントなので `readShortcuts` を書いた。slug / title / icon
  を欠く pin は落とす（ナビゲートできない、あるいは空チップになる）。
- **`accountingUi` / `collectionUi`** — プラグインパッケージが
  `AccountingApiCall = <T = unknown>(path, opts) => Promise<ApiResult<T>>` と**generic を宣言して
  いる**ので、T を選ぶのはプラグイン、作るのはホスト。構造的に検証不可能。`asDeclared` を seam に
  置き、`consistent-type-assertions` の allowlist に理由付きで追加した
  （`pluginRuntime.ts` と同じ扱い）。**upstream に issue を立てた: receptron/gui-chat-protocol#30。**

## 見つかった実際の穴

### `useSessionFeed` の履歴経路がライブ経路より甘かった

`parse: (raw: unknown) => T | null` は**ライブチャンネル用に既にあり**、コメントにも
「The channel carries `unknown`, and this used to be `data as T`」と書いてある。ところが
**履歴の初回ロードだけ `data[historyKey] ?? []` を素通し**していた。チャンネルなら落とされる形が
初回表示には載る。同じ reader を通すようにした。

（#1325 の `loadConfig` と同じ構図: 片方の経路だけ検証している。）

### `useDirLists` の `rowsOf<T>`

`rowsOf<ResumableSession>(body.sessions)` は「サーバに聞いていない形を名乗る」形。ガードを取る
形に変え、3 リストぶんのガードを書いた。

### `useGridActivity` の seed が誤った reader を指していた

`const data: Record<string, CellActivity> = await res.json()` を注釈だけで通していた。seed の
エンドポイントは **id をキーにしたマップ**を返し、値の中に `id` は入っていない。既存の
`parseSessionActivityPayload` は `id` で判定するので**この形には使えない**。
`readCellActivity` を新設した。

## その他

`useHeaderButtons` / `ToolsPane` / `SkillMenu` / `useLaunchOptions` など、`res.json()` を
`jsonBody` + 要素ガードに置き換え。ガードは「その画面が**描画・操作に使う**フィールド」を見る
（例: ヘッダーボタンは `id`（実行時に再解決するキー）/ `label`（描画）/ `run`（押した時の挙動））。
