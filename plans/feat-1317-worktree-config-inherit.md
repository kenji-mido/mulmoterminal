# feat #1317 — worktree に `.mulmoterminal.json` を引き継ぐ

## 背景

`.mulmoterminal.json` は `.gitignore` に入っている（このリポジトリの `.gitignore:32`）ので、
`git worktree add` した先には存在しない。結果、親リポのセルだけが設定した色・バッジ・名前で表示され、
そこから切った worktree のセルは既定テーマの無地になる。`orderPriority` も未設定扱い
（`UNSET_PRIORITY = Infinity`）なので priority ソートで一番後ろに飛ばされる。

## 決定事項

- 引き継ぐ: `name` / `theme` / `colors` / `fontSize` / `fontFamily` / `provider` / `model`
  （そのまま）、7つの hex 色（色相を回す）、`orderPriority`（+1）。
- 引き継がない: `sound` / `sounds`（cwd 内のファイル参照。worktree に実体が無い）、
  `addDirs`（config 自身のディレクトリ基準で相対解決されるので、worktree に置くと別の場所を指す）、
  `skills` / `buttons` / `chips` / `appendSystemPrompt`（今回のスコープ外）。
- 色は **色相のみ** を N×12° 回す。彩度・明度は UI が調整済みのコントラストなので触らない。
  無彩色（S=0、`headerTextColor: "#ffffff"` など）は回しても変わらないので自動的にそのまま残る。
- `orderPriority` は **親が設定しているときだけ** 親の値 +1 を書く。整数のままなので
  `normalizeOrderPriority`（safe integer 限定）に手を入れる必要がない。
- N はその repo の managed worktree の**作成時点での本数**。config に焼き込むので、
  後から別の worktree を消しても既存 worktree の色は動かない。

## 実装

### 1. `server/config/hue-rotate.ts`（新規・純粋関数）

`rotateHue(hex, degrees)`: `#rrggbb` → RGB → HSL → 色相を回す → `#rrggbb`。
`#rrggbb` でない入力と無彩色は入力をそのまま返す（round-trip の丸め誤差も避ける）。

### 2. `server/config/worktree-dir-config.ts`（新規）

- `inheritedWorktreeConfig(parent: DirConfig, index): Record<string, unknown>` — 純粋。
  引き継ぐキーの抽出＋色相回転＋`orderPriority` +1。null のキーは出力に入れない。
- `writeInheritedDirConfig(parentDir, worktreeDir, index): boolean` — 上を使って書き出す。
  引き継ぐものが1つも無ければ書かない（空ファイルを作らない）。既にファイルがあれば書かない。

入力に `loadDirConfig()` の戻り値を使うのが要点。あれは各フィールドを zod で検証済みなので、
書き出す値は**構成上つねに妥当**であり、書く前にもう一度スキーマを通す必要がない。

### 3. `server/git/worktrees.ts`

`createWorktree()` の `worktree add` 成功直後に1箇所だけ差し込む。呼び出し元は
`worktree-routes.ts`（ランチャー）と `issue-work.ts`（issue 起点）の2つあり、
呼び出し側に置くと片方だけ実装漏れになる。

親の設定は **`repoRoot()`（メインの作業ツリー）** から読む。worktree から worktree を切っても
グラデーションの基準はつねにプロジェクト本体になる。

**git が無視する場合だけ書く**（`git check-ignore --quiet`）。無視されない場所に書くと
worktree の `git status` に未追跡ファイルが出る。それは単に汚いだけでなく、`isDirty()` が
その status を読むので `removeWorktree()` が「自分で書いたファイル」を理由に掃除を拒否する。

## テスト

- `test/server/config/hue-rotate.spec.ts` — 既知の値、無彩色、不正な hex、360 の wrap、
  回した色が彩度・明度を保つこと。
- `test/server/config/worktree-dir-config.spec.ts` — 引き継ぐ／引き継がないキー、
  index ごとに色が変わること、`orderPriority` の +1 と未設定、空の親、既存ファイルを上書きしないこと。
- `test/server/git/worktrees.spec.ts` — 実際に git repo を作って
  `createWorktree` が worktree 側に config を書くこと、`.gitignore` が無ければ書かないこと、
  書いた後も `isDirty()` が false のままであること。
