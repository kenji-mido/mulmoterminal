# fix(lint): 型アサーション（`as`）を ESLint で止める (#1231)

`CLAUDE.md` は `as` を禁止しているのに ESLint が強制しておらず、規約と実際が乖離していた。
ルールを入れ、既存の違反を **1ファイルずつ** 潰していく。

## 実際の数（ESLint で計測。issue の記載より多い）

issue には「本体 90 箇所 / 51 ファイル」とあるが、これは grep ベースの概算だった。
`@typescript-eslint/consistent-type-assertions` を実際に有効化して数えると:

| 対象 | 箇所 | ファイル |
|---|---|---|
| server | 71 | |
| src | 64 | |
| common | 12 | |
| scripts | 2 | |
| **合計** | **149** | **73** |

`as const` は**このルールでは報告されない**ことを確認済み（フラグされた 149 行のうち
`as const` を含む行は 0。リポジトリ内では 42 ファイルが `as const` を使っている）。
つまり定数アサーションは今までどおり書ける。

## 進め方

issue の段階的導入に従う。

1. **`warn` で導入**（CI を落とさず全件を可視化） ← 済
   - テスト（`**/*.spec.*` / `**/*.test.*` / `test/**`）は override で対象外。
     不正な入力をわざと作る・部分モックを渡す、といった正当な用途があるため。
2. **1ファイルずつ直す** ← 進行中
3. 直せないものを `eslint.config.js` の allowlist に **1エントリ1理由** で移す
4. 最後に **`error`** へ上げる

インラインの `eslint-disable` は使わない（`CLAUDE.md` で禁止。debt が現場に隠れるため）。

## `as` を消すときの型付けの原則

- **アサーションではなく注釈にする**。`const x = v as T` は無検査だが、`const x: T = v` は
  コンパイラが代入可能性を検証する。同じ見た目で意味が正反対。
- **本当に実行時にしか分からないものだけ**、型ガード（`(x: unknown): x is T`）か
  ナローイング関数にする。
- **`as unknown as T` は原則として直す**。二段にしないと通らない = 型が重なっていない、
  つまり「コンパイラが強く反対している」という意味。

## 結果: 149 → 4（allowlist 2 ファイル）、ルールは `error`

```
149 → 137 → 125 → 112 → 91 → 73 → 52 → 36 → 34 → 31 → 29 → 24 → 20 → 13 → 10 → 8 → 6 → 4
```

残った 4 箇所（3 サイト）は**いずれも他人の型が間違っている**もので、ローカルな型付けでは
表現できない。`eslint.config.js` の allowlist に理由と「何が入れば消えるか」を書いた。

| ファイル | 理由 |
|---|---|
| `server/routes/mcp-routes.ts` | `@modelcontextprotocol/sdk` の宣言バグ（upstream issue #2083） |
| `src/composables/pluginRuntime.ts` | gui-chat-protocol の不健全なジェネリック。署名変更は全プラグインを壊す |

**upstream に直せるものは直した**: `modalTeleportTarget` の型が狭すぎた件は
mulmoclaude#2721 を出してマージされ、1.2.3 で publish されたので、ホスト側の
二段キャストは消えている（#1278）。

### 完了条件の確認

- [x] `consistent-type-assertions` が `error` で入っている
- [x] テストは対象外（`*.spec.*` / `*.test.*` / `test/**`）
- [x] 残る例外は `eslint.config.js` に理由付きで 2 ファイルのみ
- [x] インラインの `eslint-disable` は 0 件
- [x] `CLAUDE.md` の規約と、実際に止まるものが一致

## 進捗（着手順）

| # | ファイル | 箇所 | 対応 | PR |
|---|---|---|---|---|
| 1 | `src/plugins-registry.ts` | 12 | 型ガード + 注釈 + 不要キャスト削除 | #1234 |

## 直しながら見つかった問題（#1231 に記録する）

### 1. `viewComponent` の `undefined` を握り潰していた — `src/plugins-registry.ts`

6 箇所の `viewComponent as Component` / `as unknown as Component` は、**Vue の型不一致では
なかった**。外すと出る本当のエラーはこれ:

```
Type 'Component | undefined' is not assignable to type 'Component'
```

`gui-chat-protocol/dist/vue.d.ts:164` が `viewComponent?: Component;` と **optional** で
宣言している（Vue の View を持たないプラグインがあり得るため）。キャストはその
`undefined` の可能性を黙らせていた。通れば `undefined` がレジストリに入り、Canvas は
「描けないツール」を抱えることになる。

**現時点では顕在化しない**（対象 5 パッケージはいずれも実際に viewComponent を出荷している
ことを dist で確認済み）。潜在的な穴であって、今動いていないバグではない。

対応: `viewOf(packageName, viewComponent)` で存在を確認し、無ければパッケージ名付きで
throw する。ナローイングなのでキャストではない。

### 2. 9 箇所のうち 2 箇所は「そもそも不要」だった

`CollectionCardView as Component` と `AccountingView as Component` は、外しても
型エラーが出なかった。`.vue` の SFC は `Component` に代入可能なので、最初から無意味な
キャストだった。**キャストは一度書かれると誰も必要性を再検証しない**ことの実例。

### 3. `config as { packages?: string[]; local?: string[] }` は注釈で足りた

`plugins.json` の `local` が空配列 `[]` のため `never[]` と推論され、
`new Set(cfg.local ?? [])` が `Set<never>` になって `.has(name: string)` が
`Argument of type 'string' is not assignable to parameter of type 'never'` になる、
というのが原因だった。

`const cfg: { packages?: string[]; local?: string[] } = config;` と**注釈**にすれば、
`never[]` は `string[]` に代入可能なのでそのまま通る。しかもこちらは
**コンパイラが検証する**ので、JSON の形が変わればここで落ちる（キャストなら黙って通る）。

## 検証

型と lint だけでは足りない。`plugins-registry.ts` は Canvas の全プラグインを登録するので、
実際にアプリを起動して確認した:

- 8 ツール（presentDocument / presentForm / presentChart / presentHtml / presentMulmoScript /
  presentCollection / manageAccounting / generateImage）すべてが登録され、
  `viewComponent` が **nullish でない**ことをブラウザ上で確認
- 画面が描画され、uncaught console error が 0
