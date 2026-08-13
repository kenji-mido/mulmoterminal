# refactor: fetch のタイムアウトを共有ヘルパに集約する (#1393)

## 出発点 — 実測

`src/` の `fetch(` は **80 箇所**。うちタイムアウトがあるのは **10 箇所**で、
その 10 箇所は同じ `AbortController` + `setTimeout` + `clearTimeout` を**各ファイルに書き写している**。
共有ヘルパは無い。

既に付いている値を集めると、**このリポジトリは既に「値は呼び出しごと」を実践している**:

| 値 | 箇所 |
| --- | --- |
| 5s | `voiceModelStatus`（状態プローブ） |
| 8s | `useCost` / `useRateLimits` / `useLaunchOptions` / `useGoogleLink` / `translateUi` |
| 10s | `useHandoff` / `canvasOpenFile` |
| **90s** | `CommandCell`（LLM 要約） |
| **300s** | `dropUpload`（ファイルアップロード） |

**だから一律置換はしない。** 8s を既定にすると transcribe やモデルダウンロードを壊す。
既定値は多数派の 8s、呼び出しごとに上書きできる形にする。

## 設計

`src/utils/fetchWithTimeout.ts`（`fetchJson.ts` の隣）:

```ts
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
export function fetchWithTimeout(input, init?, timeout_ms = DEFAULT_REQUEST_TIMEOUT_MS): Promise<Response>
```

- 呼び出し側が `init.signal` を渡していたら**合成する**（アンマウント時のキャンセルを潰さない）。
- `finally` で `clearTimeout`。
- `fetchJson` が内部でこれを使う → `fetchJson` の呼び出し側は自動的に bounded になる。

## 段取り（コミットを分ける）

1. **ヘルパ追加 + `fetchJson` を載せ替え** — 挙動が変わるのは `fetchJson` 経由の呼び出しだけ。
2. **インライン 10 箇所の移行** — 値は据え置き。**挙動は変わらない**、写しが消えるだけ。
3. **未 bounded の掃除** — 呼び出しごとに分類する。

### 3 の分類方針

| 種別 | 扱い |
| --- | --- |
| 速い API 読み書き（設定・一覧・状態） | 既定 8s |
| git 操作（worktree 作成 / diff） | 長め。リポジトリの大きさに依存する |
| LLM・生成・文字起こし・アップロード | 既に値がある物に合わせる。無い物は**根拠を書いて**長い値 |
| 外部サービス経由（GitHub） | ネットワーク次第なので長め |
| ストリーミング / 意図的に無制限 | **理由をコメントに書いて据え置き** |

判断はサーバ側のルート実装を読んで決める。**推測で値を付けない。**

## 検証

- ヘルパの単体テスト（既定値 / 上書き / 呼び出し側 signal との合成 / `clearTimeout` される）
- **各テストは修正を外すと落ちることを確認する**
- 移行した箇所は挙動が変わらないことを既存テストで担保
- `yarn format` / `lint` / `typecheck` / `build` / `test`
- 実ブラウザで、値を短くした呼び出しが実際に成功することを確認（特に git 系）
