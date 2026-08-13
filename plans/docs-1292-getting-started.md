# docs: ガイドに「はじめに（起動まで）」を独立ページとして追加する

issue: #1292

## 背景

起動手順は `docs/guide/{ja,en}/index.md` にあるが、コンセプト・機能紹介・体験談の下
（150 行目付近）に埋まっている。ガイドのサイドバー先頭は FAQ で、「最初にここを見れば
起動できる」ページが存在しない。エンジニアでない読者は、Node.js も Claude Code も
入っていない状態から始まるのに、その導線がどこにも無い。

## 方針

`getting-started.md` を ja / en 両方に新設し、**ガイドの最初のページ**にする。

- **1 ページで起動まで完結させる**。他ページに飛ばないと起動できない、という状態にしない。
- **起動コマンドを最上部に置く**。環境が揃っている人はスクロールせずに終わる。
- その下に「ゼロから」を Step 1〜4 で置く。各ステップは
  **これは何か → mac の入れ方 → Windows の入れ方 → 確認コマンド → 公式リンク**の順で揃える。
- 用語（ターミナル / Node.js / npm / npx / Claude Code / git / GitHub / gh）は、
  読み進める順に、その場で 1〜2 行ずつ説明する。用語集ページへの依存にしない。
- 詳細（機能・設定・FAQ）は既存ページへリンクするだけにして、内容を二重に持たない。

## nav_order

ガイド内の既存 nav_order は 1〜11 が通常ページ、12〜39 がバージョンページで埋まっている。
新ページを 1 にすると 78 ファイルの付け替えになるため、**`nav_order: 0`** を使う。

just-the-docs 0.12.0 の `_includes/components/nav/sorted.html` は
`nav_order != nil` で数値グループに振り分けて `sort` するだけなので、0 は数値として
最初に並ぶ（Liquid では 0 は truthy、`jsonify | slice: 0` は `0` で文字列扱いにならない）。
リリース時のバージョンページ採番規約（最小の空き番号を使う）にも影響しない。

## ページ構成（ja / en 共通）

1. 起動コマンド（3 行で要約 + `npx mulmoterminal@latest`）
2. 動かなかった人向けの分岐（下の Step へ）
3. Step 0: ターミナルを開く（mac: ターミナル.app / Windows: PowerShell）
4. Step 1: Node.js（公式インストーラ、`node -v` で 22.9 以上）
5. Step 2: Claude Code（`npm i -g @anthropic-ai/claude-code` → `claude` でログイン、料金の前提）
6. Step 3: git と gh（GitHub の説明込み。無くても起動はする、と明示）
7. Step 4: 起動して最初にやること（ランチャフォームの画像を再利用）
8. 環境チェック `npx mulmoterminal@latest init`
9. うまくいかないとき（`command not found` / npx キャッシュ破損 / ポート使用中 / Windows の tmux）
10. 次に読むもの

## 事実確認のソース

- Node 要件 `>=22.9` — `package.json` の `engines`
- 起動時に必須なのは `claude` だけ（git/gh が無くてもサーバは起動する）— `bin/mulmoterminal.js` の
  `main()` は `claudeInstalled()` のみで exit する
- `init` が出すチェック項目 — `bin/mulmoterminal.js` の `PATH_TOOLS` と `runInit()`
- npx キャッシュ破損の案内 — `bin/npx-cache-hint.js` / `docs/index.md`
- ポート既定値と `--port` / `--cwd` / `--no-open` — `bin/mulmoterminal.js` の `printHelp()`
- Windows に native tmux が無い — README の要件表

## 既存ページの更新

- `docs/guide/{ja,en}/index.md` — 冒頭の告知ブロックと「まずは起動」から新ページへ誘導し、
  「このガイドの読み方」の 1 番目に入れる。CLI 表と `init` の説明は index に残す
  （index は概要、getting-started は手順、という役割分担）。
- `docs/index.md` — サイトトップの言語別リンクの先頭に追加。
- `README.md` — Install & run から新ページへ 1 行リンク。
