# chore(deps): gui-chat-protocol 2.0.0 へ移行し、ツリー内を 2.0.0 一本にする (#1342)

## ゴール

`gui-chat-protocol` をツリー内 **2.0.0 の 1 コピーだけ**にする。それを peer に持つ
`@mulmoclaude/*` / `@mulmochat-plugin/*` も同時に 2.0.0 へ上げる。`gui-chat-protocol` に
依存しない `@mulmoclaude/x-plugin`（`^1.0.2`）と `@mulmochat-plugin/ui-image`（`^0.4.1`）は
2.0.0 が存在しないので対象外。

コピーが 1 本であること自体が要件になるのは、`PLUGIN_RUNTIME_KEY` が Vue の
`InjectionKey`（Symbol）だから。2 コピーあると provide 側と inject 側で別の Symbol に
なり、ホストが provide した runtime をプラグインの View が受け取れなくなる。

## 2.0.0 の破壊的変更

`dispatch` / `subscribe` / `getConfig` から「戻り値位置にしか現れない型引数」が削除され、
reader (`parse`) を渡す形になった。`publish<T>` は削除。

|  | before | after |
|---|---|---|
| `dispatch` | `dispatch<T>(args)` | `dispatch(args)` → `unknown` / `dispatch(args, parse)` |
| `subscribe` | `subscribe<T>(name, handler)` | `subscribe(name, handler)` / `subscribe(name, { parse }, handler)` |
| `getConfig` | `getConfig<T>(key)` | `getConfig(key)` → `unknown` / `getConfig(key, parse)` |
| `publish` | `publish<T>(name, payload)` | `publish(name, payload)` |

`BrowserPluginRuntime` / `PluginRuntime` / `ToolContextApp` を実装するホストは全て追従が
必要。リファレンス実装は gui-chat-protocol の `test/types/fakeHostRuntime.ts`
（型アサーション 0 で実装できることが 2.0.0 の要件そのもの）。

## この repo の影響範囲

ホスト実装は 2 箇所。実際に直す必要があったのは 1 箇所だけ。

| ファイル | 実装しているもの | 対応 |
|---|---|---|
| `src/composables/pluginRuntime.ts` | `BrowserPluginRuntime` | **要修正**（`dispatch` / `subscribe`） |
| `server/infra/pluginRuntime.ts` | `PluginRuntime` | 変更不要（`publish` は payload の型が緩くなるだけ、`fetchJson` は元から `parse` 対応済み） |

`ToolContextApp` は `server/infra/plugins-registry.ts` の `APP_CONTEXT` が実質それに当たるが、
その型を名乗って実装しておらず `getConfig` も呼んでいないため影響なし。

## 最大の落とし穴 — dispatch は型検査では移行漏れが出ない

`dispatch` の新しい型はオーバーロードで、TypeScript は**オーバーロード先を緩く照合する**。
そのため `as T` を使った旧実装は新シグネチャに対しても `yarn typecheck` を通ってしまう。

```ts
// 旧実装: 2.0.0 に対しても型検査を通るが、parse を無視して生データを返す
return async <T = unknown>(args: object): Promise<T> => (await res.json()) as T;
```

壊れるのは実行時だけで、しかもプラグイン側が `dispatch(args, parse)` を使い始めた瞬間に
初めて顕在化する。よって**挙動をテストで固定する**以外に守る手段がない。

## 実装方針

リファレンスホストと同じ「オーバーロード宣言 + rest tuple union を `length` で narrowing」
の形を採る。これが型アサーションなしで `opts` と `handler` を読み分けられる唯一の形。

```ts
function subscribe<T>(
  eventName: string,
  ...rest: [handler: (payload: unknown) => void] | [opts: SubscribeOptions<T>, handler: (payload: T) => void]
): () => void {
  if (rest.length === 1) return onChannel(channel, rest[0]);
  const [opts, handler] = rest;
  ...
}
```

`subscribe` には加えて **`parse` が throw したらそのフレームだけ捨てる**ガードを入れる。
protocol が推奨する reader のイディオムは `Schema.parse(raw)` で、Zod の `parse` は throw する。
ガードが無いと不正なフレーム 1 個で socket のコールバックごと落ち、**同じチャンネルの他の
subscriber も巻き添えで死ぬ**。

## 手順

1. `yarn add` で対象パッケージを `^2.0.0` へ（`@receptron/task-scheduler` は core 2.0.0 の
   peer 要求により `^1.0.3`）
2. `npx yarn-deduplicate yarn.lock` — `@mulmoclaude/core` が `^1.14.0` / `^1.14.1` で
   二重解決していたので潰す
3. `src/composables/pluginRuntime.ts` の `dispatch` / `subscribe` を reader 契約へ
4. `src/composables/collectionUiRules.ts` — core 2.0.0 で `RemoteViewPageRequest.fields` が
   `string[] | undefined` になったため `exactOptionalPropertyTypes` 対応
5. `test/src/composables/pluginRuntime.spec.ts` を新規追加
6. `rm -rf node_modules && yarn install --frozen-lockfile` の上で lint / typecheck / build / test

## 検証

lockfile を書き換えたので、**warm な node_modules ではなくクリーン install を ground truth**
にする。加えて build 成功は動作の保証にならないので、実サーバまで起動して確認する。

- `gui-chat-protocol` が `node_modules/gui-chat-protocol` の 1 コピーのみ
- peer warning 9 件（`gui-chat-protocol@^1.2.0` 要求）が消える
- throw-drop ガードはミューテーション検証する（try/catch を外すとテストが赤くなること）
- 実サーバ起動 → プラグイン 11 ツールが登録される / `/api/plugin/*` の dispatch が 200 /
  ブラウザで UI が描画されコンソールエラーが無いこと
