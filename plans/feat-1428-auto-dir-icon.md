# feat #1428 — リポジトリ自身の favicon を自動で拾う

#1421 の `icon` は書かないと何も出ない。リポジトリが既に favicon を持っているなら拾う。

## 実測が決めたこと

このマシンの git リポジトリ **157個**をスキャンした結果:

```
検出できるアイコンを持つリポジトリ: 26 / 157 (17%)
public/favicon.ico 22 · public/apple-touch-icon.png 6 · public/site.webmanifest 4
public/favicon.svg 3 · public/manifest.json 1
ルート直下の favicon.* / logo.* / docs/logo.* / assets/logo.*  0
```

**全部 `public/` 配下**だったので、探索は少数のパスで足りる。ルートも一応見るが（慣習として存在する）、
`docs/logo.*` や `assets/logo.*` は 0 件だったので**入れない** — ロゴはアイコンとは限らず、
README 用の横長画像であることが多い。

## 他ツール互換について

リポジトリ内のファイルからアイコンを出すターミナルは無い（iTerm2 / Windows Terminal はプロファイル単位、
kitty / Alacritty / Ghostty / tmux / Zellij は該当機能なし）。VS Code の Peacock が近いが色でありアイコンではない。
**互換を取る相手は web の favicon 規約**であって、他のターミナルのフォーマットではない。

## 「ファイルが設定した値」と「表示される値」を分ける

これが設計の中心。

- `loadDirConfig().icon` は**ファイルが書いた値のまま**。worktree 継承（生の文字列を引き継ぐ）と、
  設定プレビューの applied / ignored 報告が嘘にならない。
- 自動検出は表示側の解決関数 `dirIconFor(cwd)` に入れる。`publicDirConfig` と `/api/dir-icon`、
  設定プレビューがこれを使う。
- worktree には**自動検出の結果を書かない**。worktree 側でも同じファイルが同じ相対パスにあるので、
  自分で検出する。検出結果を書き込むと「ユーザーが指定していないパス」が config に焼き付く。

## 探索順

ファイル存在チェックだけで済む順に並べ、manifest は最後。1つでも当たれば JSON を読まない。

1. `public/favicon.svg` → `favicon.svg`（スケーラブル、14px でも綺麗）
2. `public/apple-touch-icon.png` → `apple-touch-icon.png`（180px 前後で品質が高い）
3. `public/favicon.png` → `favicon.png`
4. `public/favicon.ico` → `favicon.ico`
5. manifest（`public/site.webmanifest` / `public/manifest.json` / ルートの同名）の `icons[]`

manifest の扱い:

- `src` は**相対のみ**。`http(s)` は受け付けない — ユーザーが書いた URL と違い、
  自動で外部へ取りに行くことになるため。
- 先頭 `/` は **manifest 自身のディレクトリ**（= web ルート）基準で解決する。Vite の `public/` 配置では
  `"src": "/pwa-192.png"` が `public/pwa-192.png` を指すため。
- `purpose: maskable` は後回し（余白付きで、素で出すと小さく見える）。同 purpose なら `sizes` の大きい方。

確認は明示指定と同じ経路（`resolveDirIcon` の file 分岐）を通す — cwd 内限定・realpath 再確認・画像拡張子のみ。
規則を書き直さないこと自体が目的で、探索が新しい抜け道にならないようにする。

## 切り方（既定 on なので必須）

- プロジェクト単位: `"icon": false` — 「アイコンなし。探すな」。`appendSystemPrompt` と同じ三状態
  （未設定 / 明示 false / 値あり）。
- 全体: `~/.mulmoterminal/config.json` の `autoDirIcon: false`。
  既定 on は 26 リポジトリの見た目を一斉に変えるので、1か所で戻せる必要がある。

## コスト

`existsSync` が最大 8 回 + manifest 1 読み。`loadDirConfig` は既に `existsSync` + JSON 読み + realpath を
しているので桁は変わらない。`/api/dir-config` はクライアント側で cwd ごとにキャッシュされ、
config 書き込み時にしか無効化されないので、ポーリングではない。**先にキャッシュを足さない** —
必要になったら計測してから。

## テスト

- 探索順（svg > apple-touch > png > ico > manifest）、`public/` 優先、ルートも見ること
- manifest: 相対 src、先頭 `/`、`http` を無視、maskable を後回し、sizes 最大、壊れた JSON
- `"icon": false` で探さない / `autoDirIcon: false` で探さない
- 明示指定があるときは検出しない（探索コストも払わない）
- `loadDirConfig().icon` は自動検出で変わらない（worktree 継承とプレビュー報告の担保）
- cwd 外へ出る manifest src を拒否

## ドキュメント

README、`docs/guide/{en,ja}/config.md`、`mulmoterminal-dirs` の SKILL.md。
「既定で拾う。要らなければ `"icon": false`」が最初に伝わるように書く。
