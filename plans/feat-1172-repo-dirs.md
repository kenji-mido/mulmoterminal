# feat(#1172): GitHub repo とローカル clone を紐づける

#1026 の段階2。「この repo のローカル clone はどれか」にアプリが答えられるようにする。
段階3（`/prs` の issue 行から起動する）がこの答えを使う。

## いま無いもの

`prRepos`（手入力の `owner/repo`）と `cwdPresets`（ローカルパス）は独立していて、繋ぐデータが無い。
`dir → repo` は `resolveGithubUrl` ＋ `repoFromWebUrl` で既に解決できる（`/api/pr-phase` と
work-comment が使用中）。無いのは**逆引き**。

## 決めたこと

- **記録が主、自動解決はフォールバック**（#1026 本体と同じ形）。config に `repoDirs`（repo → 選ばれた dir）
- **候補の並びは `orderPriority` → dir 名**。既存の `orderByDirPriority` は同順位を入力順のまま保つので、
  **dir 名でソートした配列を渡せば未設定分が名前順に落ちる** — 新しいソート規則を書かない
- **`prRepos` は手入力のまま維持**。cwdPresets から派生させると、clone はあるが watch していない repo が
  勝手に増え、clone を持たない watch 専用 repo が消える（開発機の実データで両方発生）

## 実装

### 1. `common/repoDirs.ts` — wire 型

`/api/repo-dirs` のレスポンス形。**両側が読む**ので `common/`（段階3 の UI と、将来スマホ側）。

### 2. `common/dirPriorityOrder.ts` — 並び替えヘルパの移動

`orderByDirPriority` は今 `src/components/` にあるが、サーバも候補を並べるのに要る。
CLAUDE.md の「両側が決めるものは `common/`」に従って移す（UI 側の import を張り替えるだけ）。

### 3. `server/git/repo-dirs.ts` — 逆引き

- `cwdPresets` の各 path を `resolveGithubUrl` → `repoFromWebUrl` で repo に解決し、repo ごとに束ねる
- **`createTtlCache` に乗せる**（`pr-for-branch` / `prPhase` / `github-star` と同じ使い方）。
  16 dir ぶんの `git config --get` を毎リクエスト spawn しない
- 非 git dir・GitHub でない remote は候補から落とす（エラーではない）
- 各候補に `.mulmoterminal.json` の `orderPriority` を添える（`publicDirConfig`）
- `repoDirs` に記録があり、**その dir が今もその repo に解決するなら** primary。そうでなければ記録を無視

### 4. `repoDirs` config

`Record<owner/repo, 絶対パス>`。sanitize は repo 形式 ＋ 絶対パス。
**`OBJECT_FIELDS` に入れる** — キー付きマップなので、`{"repoDirs": []}` が「全消し」として
通ってしまう既知の罠（`sounds` と同じ）を塞ぐ。

### 5. `GET /api/repo-dirs`

読み取りのみ。書き込みは既存の `POST /api/config` の `repoDirs` フィールド（段階3 が使う）。

## テスト

- 逆引き: 複数 clone が1 repo に束なる / 非 git dir を落とす / GitHub でない remote を落とす
- 並び: `orderPriority` 昇順 → 未設定は dir 名順（両方混在で1本のテスト）
- primary: 記録が効く / 記録された dir が別 repo を指すようになったら無視 / dir が消えたら無視
- sanitize: 不正な repo キー・相対パス・配列（全消し防止）
- ルート: 形と、clone を持たない repo が出ないこと

## やらないこと

- `/prs` の UI（段階3 = #1173）
- `prRepos` の自動生成（採らないと決めた）
