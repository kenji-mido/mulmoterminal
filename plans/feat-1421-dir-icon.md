# feat #1421 — `.mulmoterminal.json` の画像アイコンをセルヘッダーに出す

リポジトリに置いた画像（favicon 的なもの）を `.mulmoterminal.json` の `icon` で指定し、
そのディレクトリで開いた**セルのヘッダー**に出す。`name` バッジと色分けの画像版で、
グリッドに並んだセルを一目で見分けるためのもの。

## 決めたこと

| 論点 | 決定 |
| --- | --- |
| キー名 | `icon` |
| ソース | 相対パス（cwd 内限定） / `http(s)://…` / `data:image/…` |
| 形式 | png, jpg/jpeg, gif（**アニメ可**）, webp, avif, svg, ico, bmp |
| 表示場所 | セルヘッダー、cockpit ロスター + フィルムストリップ、ランチャーのディレクトリチップ |
| 対象外 | single view（現存しない）、ブラウザ favicon の差し替え |

## なぜ `sound` と同じ形にするか

`sound` は既に「cwd 内の相対パスだけを受け付け、生パスはサーバに留め、`/api/dir-sound` で配信する」
という形になっている。`icon` の要件はこれとほぼ同じ（プロジェクトが指した先を無制限に読ませない）ため、
確認手順（lexical `isWithin` → `existsSync` / `isFile` → `realpath` で再確認）をそのまま踏襲する。

違いは 2 つ:

1. **外部 URL / data: を許す。** `sound` にはこれが無い。ブラウザが直接読むので、サーバは配信に関与しない。
2. **worktree に継承する。** 後述。

## 実装

### 1. `common/dirIcon.ts`（新規）— 両側で共有する規則

サーバとクライアントが同じ答えを出さないといけないものだけを置く:

- `DIR_ICON_MIME_BY_EXTENSION` — 拡張子 → MIME。サーバの配信 Content-Type と、拡張子の許可リストの
  両方がこれ 1 つから出る。
- `dirIconMimeForPath(path)` — 拡張子から MIME、画像でなければ `null`。
- `isRemoteDirIconUrl(raw)` — `http:` / `https:` / `data:image/<許可 MIME>` のときだけ true。
  `file:` `javascript:` `blob:` などは false。
- `isUsableDirIconSrc(raw)` — クライアントが `<img src>` に入れる直前の最終チェック。上記に加えて
  同一オリジンの `/api/dir-icon…` を許す。
- `DIR_ICON_MAX_CHARS` — 指定文字列の上限（data: URI が `/api/dir-config` のレスポンスを膨らませるため）。

`common/pastedImageTypes.ts` と同じ理由でここに置く: 片側だけが知っている形式があると、
サーバが配信できる画像をクライアントが弾く（あるいはその逆）ことになる。

### 2. サーバ

**`server/config/dir-icon.ts`（新規）**

```ts
export type DirIcon =
  | { source: "file"; path: string; ref: string; mime: string }
  | { source: "url"; url: string };

export function resolveDirIcon(cwd: string, input: unknown): DirIcon | null;
```

- `ref` は**書かれたままの相対パス**。worktree 継承がこれを必要とする（下記）。
- file 側の確認順は `resolveDirSound` と同じ。加えて拡張子が `dirIconMimeForPath` で解決できること。

**`dir-config.ts`**

- `DirConfig.icon: DirIcon | null` を追加（`sound` と同じく解決済みの値）。
- `PublicDirConfig.iconUrl: string | null` — ブラウザがそのまま `<img src>` に入れられる値。
  file なら `/api/dir-icon?cwd=<cwd>`、url ならその URL 自体。
- `DirChrome` には**入れない**。サーバ側とクライアント側で型が違う（`theme` / `colors` / `sound` と同じ扱い）。

**`config-schema.ts`**

`writableDirConfigSchema` に `icon`（`nonEmptyText.max(DIR_ICON_MAX_CHARS)`）を追加。生成される
`dir-config.schema.json` にも入るので、スキルが検証に使える。

**`server/routes/dir-routes.ts` — `GET /api/dir-icon?cwd=…`**

`/api/dir-sound` と同じ形。パスはリクエストから来ず、そのディレクトリの config から読む。

- icon が無い / url ソース（配信するものが無い）→ 404
- `Content-Type` は拡張子マップから明示指定（express の推測に任せない）
- `X-Content-Type-Options: nosniff` と `Content-Security-Policy: sandbox` を付ける。
  SVG をアプリ origin で直接開かれてもスクリプトが動かないようにするため
  （`server/backends/files.ts` / `collections.ts` と同じ）。
- `dotfiles: "allow"` — `.mulmoterminal/` 配下に置く運用があり得るため。

**`worktree-dir-config.ts`**

`icon` を identity キーとして継承する。ただしコピーするのは解決済みの絶対パスではなく
**`ref`（生の相対パス）または URL**。リポジトリにコミットされた画像なら worktree にも同じ相対パスで
存在するので開ける。無ければ worktree 側のローダが黙って落とすだけで、絶対パスを書いて
「相対パス限定」のルールに自分で弾かれる事故が起きない。

**`common/dirConfigSource.ts`**

`DIR_CONFIG_KEYS` に `"icon"` を追加（spec がローダのキーと突き合わせている）。

### 3. クライアント

- `useDirConfig.ts` — `DirConfig.iconUrl` を追加し、`isUsableDirIconSrc` で再検証してから採用する。
  境界での再検証は `fontSize` の再クランプと同じ方針。
- `src/components/DirIcon.vue`（新規）— 小さな `<img>`。`alt=""` / `aria-hidden`（隣の `name` バッジと
  パスが同じことを既に言っている）、`draggable="false"`、読み込み失敗時は `@error` で自分を消す。
  壊れた画像アイコンがヘッダーに残るのは、何も無いより悪い。
- 差し込み先:
  - `TerminalCell.vue` — `DirBadge` の直前。フィルムストリップのサムネイルでは他の情報と同じく省く。
  - `CellShell.vue` — 同上（launcher / command セル）。
  - `CockpitHeader.vue` — ロスター行とサムネイルのヘッダーバー。
  - `CellLaunchForm.vue` — チップの色ストライプの直後、ラベルの前。
  - `GridView.vue` — `RowChrome` に `iconUrl` を足して行に流す。
- `dirConfigDetail.ts` — 設定モーダルのプレビューに 1 行足す（「設定した / 効いている」が読めないと、
  パスを間違えたときに気づけない）。

## テスト

- `test/common/dirIcon.spec.ts` — 拡張子 → MIME、URL ポリシー（`file:` / `javascript:` / `data:text/html` を弾く）。
- `test/server/config/dir-config.spec.ts` — 相対パス OK / 絶対パス NG / `../` NG / 画像でない拡張子 NG /
  存在しないファイル NG / http・https・data OK / 上限超え NG、`iconUrl` の形。
- `test/server/config/worktree-dir-config.spec.ts` — 相対パスがそのまま継承されること。
- クライアント: セルヘッダーとチップに `<img>` が出ること、`iconUrl` が無ければ出ないこと。

## ドキュメント

- README の per-directory 設定表と jsonc 例。
- `server/skills/mulmoterminal-dirs/SKILL.md` — 見た目の identity キーなのでこのスキルが持ち場
  （`buttons` の `icon` との違いも書く）。
- `docs/guide/{en,ja}/config.md` — 両言語。
