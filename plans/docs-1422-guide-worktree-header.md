# docs(guide): worktree とヘッダーのカスタマイズを独立ページ化する

refs #1422

## 目的

ガイドで次の2つを「丁寧に、独立して」読めるようにする。

1. **git worktree** — 6 ファイルに分散していて、通しで読める場所が無い
2. **ヘッダーのカスタマイズ** — `config.md` の 1 セクションのみ・スクショゼロ・一部記述が実装と食い違う

分散側は**要約 + 新ページへのリンクに削る**。同じ話を 2 箇所に残さない（読者が迷子になるため）。

## 実装確認で見つかった、ガイドの誤り

新ページを書く前に直すべき事実誤認が 2 つある。どちらも `config.md#header` の現行記述。

### 1. `label` は画面に出ない — ホバーのツールチップ

現行: 「表示は `icon`（Material Symbol 名）＋ `label`」＝ラベルも並んで出るように読める。

実装 (`src/components/Terminal.vue`): ボタンが描くのは `b.emoji` か
`material-symbols-outlined` の `b.icon` **だけ**。`label` は `:title` と `:aria-label` に入る。
つまり **`label` はホバーしないと読めないツールチップであり、そのボタンが何かを伝える唯一の手段**。
`icon` も `emoji` も無いときのフォールバックは `bolt`。

### 2. `chips` で制御できるのは 5 つだけ

現行: 「組み込み `dir` / `git` / `work` / `diff` / `ctx` / `usage` / `status` / `tools` … 並べた順に表示、
書かなければ非表示」。

実装 (`src/components/TerminalCell.vue`): `ROW1_BUILTIN_CHIPS = {git, work, diff, ctx, usage}`。
`dir`（プロジェクトバッジ）・`status`（状態ドット）・`tools`（2段目のツール履歴）は**構造**として
常に出るので、`chips` に書いても効かず、書かなくても消えない。スキーマ (`BUILTIN_CHIPS`) は 8 つ
受け付けるため、書いてもエラーにはならず黙って無視される。

### あわせて明記すべき、現行が触れていない挙動

- **global と project の `buttons` は `id` でマージされる**（project が勝つ）。「既定セットが置換される」
  のは**組み込みの既定**の話で、2 つの設定ファイルどうしは置換ではない (`mergeHeaderConfig`)。
  `chips` は逆に **project が丸ごと勝つ**（マージしない）。
- `open` は `url` → `reveal` → `files` → `view` → `terminal` → `pickFile` の順で**最初の 1 つだけ**が
  効く (`dispatchOpen`)。1 ボタンに 1 つだけ書く。
- `view: "diff"` は現状 files ビューにフォールバックする（専用ルートが無い）。
- `run:"shell"` の `cmd` はブラウザに渡らない。押した時にサーバが `id` から引き直し、`${変数}` を
  シェルエスケープして解決する (`resolveButtonCommand`)。
- `when` は**表示の出し分けだけ**で、サーバ側のゲートではない。
- 上限は `buttons` 32 / `chips` 16。

## 成果物

### 新規

| ファイル | 内容 |
|---|---|
| `docs/guide/{en,ja}/worktree.md` | worktree の通し解説。`nav_order: 5`（scenarios の次） |
| `docs/guide/{en,ja}/header.md` | ヘッダーのカスタマイズ入門。スクショ付き。`nav_order: 7`（config の次） |

`nav_order` は既存を 1 つずつ後ろへずらす（`docs/guide/*/​*.md` を列挙して機械的に確認する）。

### header.md の構成（初心者が上から読める順）

1. **まずヘッダーを読む** — 2 段ヘッダーの各部が何か。どこがカスタマイズ対象か（右端のアイコン列）
2. **ボタンを 1 個足す** — どのファイルに書くか（global / project）、最小の JSON、before / after
3. **アイコンとツールチップ** — `label` は出ない、`icon` は Material Symbols 名、無指定は `bolt`
4. **`run` の 3 種** — `input` / `open` / `shell`。`shell` はコマンドセルが開く（スクショ）
5. **`when` で出し分ける**
6. **`order` と、2 つの設定ファイルの関係** — id マージ / 既定セットの置換
7. **`chips`** — 効くのは 5 つだけ。カスタムチップ
8. **`skills`** — Skill メニューの絞り込み（スクショ）
9. 全フィールドは `config.md#header` へ

### worktree.md の構成

1. worktree とは（1 行 + 用語集へ）
2. 作る — `OR ISOLATE IN A WORKTREE`、`agent/<task>` と issue 起点の `issue/<番号>-<slug>` の分岐元の違い
3. **1 worktree = 1 セッション** — `in use`、ディレクトリ単位の制限、Shell / launcher は対象外
4. 中で作業する — 差分バッジ、コミット / Push / Open PR
5. 閉じて片付ける — Keep / Remove / Discard & remove、管理下のものだけ削除可
6. 設定の継承 — 要点のみ、詳細は `config.md#worktree-inherit`
7. どこに作られるか — `~/.mulmoterminal/worktrees/`、`MULMOTERMINAL_HOME`

### 既存ページの削減（重複を残さない）

| ファイル | 変更 |
|---|---|
| `scenarios.md` §2 | 手順を丸ごと `worktree.md` へ移し、数行の要約 + リンクに。画像 3 枚も移す |
| `scenarios.md` §7 | リンク先を `header.md` に向け直す |
| `basics.md` | ランチャの行は残す。1 worktree = 1 セッションの長い説明は `worktree.md` へ移し、リンク |
| `github.md` | issue → worktree の導線は残す。worktree の寿命の話はリンクに |
| `config.md#header` | **全フィールドのリファレンス**として残す。入門的な前置きは落とし、冒頭に `header.md` への導線。上記 2 つの誤りを修正 |
| `config.md#worktree-inherit` | 残す（設定ファイルの挙動なので config の領分）。`worktree.md` から参照 |
| `features.md` / `faq.md` / `index.md` / `glossary.md` | 索引・要約ページなので構成は変えず、リンクだけ足す |

## スクリーンショット

CLAUDE.md の規約どおり、**ダミーの `HOME` で撮り、実在のパスを出さない**。

```
<scratch>/demo-home/
  .zshrc                       PROMPT='%1~ $ '
  .mulmoterminal/config.json   cwdPresets: demo-app / demo-api、ヘッダーの buttons / chips / skills
  projects/demo-app  (git init 済み)
  projects/demo-api  (git init 済み)
```

- 実サーバを `HOME=<demo>` で起動し、Playwright で撮る（`deviceScaleFactor: 2` → 縮小）
- tmux が**古いシェルを再アタッチする**ので、まだセッションの無いディレクトリを使う
- 撮る予定: `v4.4-header-anatomy` / `-buttons-default` / `-tooltip` / `-custom-button` /
  `-shell-command-cell` / `-skill-menu` / `-chips`

## 検証

- 内部リンクが**実在のページとアンカー**に解決すること（`docs/guide/*/​*.md` を列挙して機械確認）
- `nav_order` が両言語で重複無しの連番であること
- JSON サンプルを実際のスキーマ (`server/config/config-schema.ts`) に通して、読者の設定が壊れないこと
- `yarn format` は `.prettierignore` が `*.md` を除外するため Markdown には効かない。リンク確認は手動
