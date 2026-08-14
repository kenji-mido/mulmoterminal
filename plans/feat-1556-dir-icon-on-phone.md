# feat #1556 — ディレクトリのアイコンをスマホにも送る

`.mulmoterminal.json` の `icon`（#1421）と自動検出（#1428）で決まる絵は、いまブラウザの中だけで
完結している。同じ絵を mulmoserver PWA の**ターミナル一覧**と**ターミナル画面**に出す。
このリポジトリの担当は「ワイヤーに載せるところ」まで。描くのは receptron/mulmoserver#143。

## なぜ `iconUrl` をそのまま送れないか

ブラウザ向けの `iconUrl` は `/api/dir-icon?cwd=…`（`server/config/dir-config.ts`）で、これは
**このサーバに届く経路がある相手だけ**が読める。スマホは Firestore のコマンドドキュメント越しに
しか話さないので、同一オリジンどころか HTTP で届かない。だから画像そのものを載せる。

| `DirIcon.source` | 送るもの |
| --- | --- |
| `"url"`（`http(s)://` / `data:`） | 書かれた文字列のまま。読むのは端末自身で、ホストは関与しない |
| `"file"`（cwd 内の相対パス、自動検出も含む） | ホストが読んで `data:<mime>;base64,…` にする |

## 決めたこと

| 論点 | 決定 |
| --- | --- |
| 一覧のワイヤー | `{ sessions, icons }`。行は `iconId?`、実体は `icons` テーブル |
| `iconId` | src の SHA-256 先頭 16 桁。**内容**ハッシュなので同じ絵は 1 コピー |
| 画面のワイヤー | `SessionScreenMeta` に `icon?: string`（src そのもの）。1 セッションぶんなのでテーブル不要 |
| 1 枚の上限 | 48 KiB（**上限+1 バイトまでしか読まない**。`stat`→`readFile` だと、その間にファイルが差し替わったぶんを丸ごと読んでしまう） |
| 応答全体の予算 | 256 KiB（`icons` の src 合計、文字数） |
| 超えたら | その行に `iconId` を付けずに送る。スマホは今までどおりのグリフになる |
| リサイズ | しない（画像ライブラリを増やさない） |

### なぜテーブル＋内容ハッシュなのか

行に src を直接持たせると、同じ favicon を持つ worktree の数だけ同じ base64 が並ぶ。
このマシンには `mulmoterminal` 系のクローンが 6 個、`graphai` 系が 9 個ある。後者は
`public/favicon.ico` が 4286 バイトで全部同じなので、素直に並べると 38 KB が 4.3 KB になる。

### なぜ予算が要るのか

応答は Firestore のコマンドドキュメントで、1 MiB を超えると**書き込みが丸ごと失敗する**。
落ちるのはアイコン 1 枚ではなく一覧そのもので、これは #1042 とまったく同じ壊れ方。
`icons` は行の並び順（live が先、その中で title 順）に詰めるので、予算が尽きて削られるのは
末尾＝ユーザーが最後に見る行。

### 上限の根拠（推測ではなく実測）

このマシンの `~/ss/llm` 配下 22 リポジトリで、`dir-icon-detect.ts` と同じ候補順に見つかった
ファイルのサイズ:

| | バイト |
| --- | --- |
| 最小 | 288（`favicon.svg`） |
| 中央 | 4286（`public/favicon.ico`） |
| 平均 | 5051 |
| 最大 | 25931（`public/favicon.ico`） |

base64 で 4/3 になっても最大 ~35 KB。48 KiB の上限に当たるものは 1 つも無く、22 枚**全部**を
載せても 148 KB で 256 KiB の予算に収まる。つまり通常は誰も削られない。上限は予算であって
ノルマではなく、「1 枚の巨大な .ico が一覧を落とす」ことだけを防いでいる。

## 実装

### 1. `server/backends/remoteHost/dirIcons.ts`（新規）

読み取りを注入した純関数だけを置く。ファイルシステムも `dirIconFor` も知らない。

```ts
export interface DirIconTable { [iconId: string]: string }
export interface DirIconSources {
  iconOf: (cwd: string) => DirIcon | null;
  readIcon: (path: string) => Buffer | null; // 上限超え・読めないは null
}
export function readIconFile(path: string): Buffer | null; // 上限+1 バイトで打ち切る境界つきの読み取り
export function dirIconSrc(icon: DirIcon, read: DirIconSources["readIcon"]): string | null;
export function collectDirIcons(cwds: readonly string[], sources: DirIconSources): {
  iconIdByCwd: Map<string, string>;
  icons: DirIconTable;
};
```

`dirIconSrc` は一覧と画面の**両方**が通る 1 本の規則。ここが分かれると、一覧には出るのに
画面には出ないディレクトリができる。

### 2. `terminalScreen.ts`

- `TerminalSessionSummary` に `iconId?: string`。
- `listTerminalSessions` の戻りを `TerminalSessionListing = { sessions, icons }` にする。
  `withDirIcons(sessions, sources)` が `buildSessionList` の結果を受けて組み立てる。
- `SessionScreenMeta` に `icon?: string`、`ScreenMetaSources` に `iconOf: (cwd) => string`。
  `definedScreenMeta` が `""` を落とすので、アイコンの無いディレクトリはキーごと消える。

**`undefined` を絶対に載せない。** `iconId: map.get(cwd)` はキーが `undefined` を持ったまま残り、
Firestore が応答全体を拒否する（#1042）。`...(id ? { iconId: id } : {})` で組む。テストは
`undefinedPaths`（core）で固定する。

### 3. `server/index.ts`

`remoteHostListTerminalSessions` が `withDirIcons` を通してから返す。`remoteHostSessionScreenMeta`
に `iconOf` を足す。どちらも `dirIconFor`（`server/config/dir-config.ts`）と `readIcon` を渡すだけ。

### 4. `docs/remote-host-protocol.md`

`listTerminalSessions` の Answers 欄と `SessionScreen` の説明を同じコミットで直す
（このページ自身のルール）。

## テスト

`test/server/backends/remoteHost/dirIcons.spec.ts`（新規）:

- `url` はそのまま、`file` は `data:<mime>;base64,…` になる
- 同じ内容の 2 ディレクトリが 1 つの `iconId` を共有する
- 1 枚が上限を超えたら、その cwd には `iconId` が付かない（キーが**無い**ことを確認）
- 予算が尽きたあとの cwd には付かず、それより前の行は残る
- アイコンの無い cwd、空文字の cwd で落ちない

`terminalScreen.spec.ts` に追記:

- `withDirIcons` の結果に `undefined` が 1 つも無い（`undefinedPaths`）
- `buildScreenMeta` が `iconOf` の `""` を落とす

## 対象外

- ブラウザ favicon の差し替え（#1421 から一貫して対象外）
- サーバ側のリサイズ／再エンコード
- スマホ側の描画（receptron/mulmoserver#143）
