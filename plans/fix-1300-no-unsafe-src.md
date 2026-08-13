# fix(src): `no-unsafe-*` を UI 側でも減らす (#1300 の続き)

server を 0 にした #1321 の続き。`src/` の 262 件を **108 件**まで減らした。

| | before | after |
|---|---|---|
| 本物の `any` | 262 | **53** |
| SFC 型が解決できない偽陽性 | 0（未分離） | 55 |
| 合計 | 262 | 108 |

## 先に分かったこと: **55 件はコードでは直せない**

`TerminalGrid.vue` などの指摘の多くは `any` ではなく **「型が解決できない」** だった。

```ts
const filesPane = ref<InstanceType<typeof FilesPane> | null>(null);
filesPane.value?.flush();   // ← Unsafe call of a type that could not be resolved
```

eslint の型プログラムは **`.vue` の component 型を生成できない**ので `InstanceType<typeof
FilesPane>` が error 型になる。`vue-tsc` は解決できるため `yarn typecheck` は 0 のまま。

### 推測ではなく実証した

存在しないメソッドを呼んでみて、vue-tsc が**型付きで拒否する**ことを確認した。

```
error TS2339: Property 'thisMethodDoesNotExist' does not exist on type
  '{ $: ComponentInternalInstance; $data: {}; $props: { readonly cwd: string | null; ... }'
```

つまりこのコードは完全に型検査されている。**この 55 件は lint 側の限界**で、ルールを error に
上げるなら `.vue` をこの 5 ルールから除外する必要がある。#1300 に記録した。

## 入口は server と同じだった

| 入口 | 対応 |
|---|---|
| `Response.json()` → `any` | **`src/jsonBody.ts`** を新設（server の `requestBody` と対） |
| `JSON.parse` | `: unknown` + ガード |
| socket の `event.data` | `parseServerFrame` を `serverMessage.ts` に新設（server の `parseClientFrame` と対） |

## 見つかった実際の穴

### `useAppConfig.loadConfig` が保存パスより甘かった

`isLauncher` / `isQuickCommand` / `isUserMcpServer` は既にあり、**保存パス（297/322/328 行）は
通していた**が、**毎回のページ表示で走る `loadConfig` は素通し**だった。手で編集された、あるいは
古いバージョンが書いた config が、そのまま `launchers.value` に載る状態。

`listOf(value, guard)` を足して全リストを保存パスと同じ厳しさに揃えた。`cwdPresets` には guard が
無かったので `isCwdPreset` を追加。**この挙動変更にテストを 2 件足した**。

### `useSessions` の型注釈が嘘だった

```ts
(data.sessions ?? []).map((s: { id: string; title: string; mtime: number }): Session => ...)
```

`s` は `any` で、注釈はコンパイルを通すためだけのもの。`isSessionRow` / `isSession` を足した。
`id` はルーティング、`mtime` はソートに使うので、欠けた行は落とす。

### `TerminalCell` の `SessionDetail` が実在しない形だった

`type SessionDetail = ActivityMsg & { usage?; context? }` は `id: string` を要求するが、
**`/api/session/:id` は `id` を返さない**（ガードを足したらテストが 4 件落ちて分かった）。
`applyActivityPush` も `id` を読んでいない。型を消して record として読むようにし、
`activityPushOf` で **absent と null の区別**（`cellActivity.ts` 冒頭が説明している、
「no news」対「there is none now」）を保ったまま読む。

## ついでに動かしたもの

- **`guardMouseTracking`** を `useTerminalConnections.ts` → `terminalMouseInput.ts` へ。
  `guardMouseWheel` / `guardMouseClicks` と同じモジュールに属する関数で、`max-lines`（600）を
  超えたぶんの置き場所としても正しい。
- **`parseServerFrame`** は `serverMessage.ts` へ（「サーバのメッセージが何を意味するか」を
  既に持っているモジュール）。

## この PR で直していないもの

本物の 53 件（`useHeaderButtons` 7 / `GuiPanel` 7 ほか、19 ファイルに小さく分散）と、
`src/utils/fetchJson.ts` の `fetchJson<T>` —— **呼び出し側が名乗った T を検証せずに返す**
不健全な generic で、`gui-chat-protocol` が `parse` 必須にして解決したのと同じ形。呼び出しは
6 箇所なので直せるが、この PR とは別の判断として #1300 に残す。
