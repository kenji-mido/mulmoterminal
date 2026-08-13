# docs(guide): セルをどのディレクトリで起動するか（ワークスペース vs プロジェクト）を書く

Branch: `docs/guide-workspace-launch-dir`

## User Prompt

Slack で「MulmoTerminal の Grid View でこれまでの Single View と同じ操作をするときは、起動の dir はワークスペースを選べば良いのか？」という質問があり、「ワークスペースで起動してください。MCP も適宜 enable して」という回答と、「記載が無ければ document(guide) に追加したほうが良い」という指摘が出た。

このことがガイドに書いてあるかを確認し、無ければ worktree で追加する。

## 調査結果 — 書かれていなかった

読み手が探す場所には無い:

- `docs/guide/*/v4.0.0.md` の単一ビュー廃止の対応表 — `/chat` → セル拡大 / Canvas / ロスター / Collections の対応はあるが、**どのディレクトリで起動するかの行が無い**。単一ビューはサーバが `CLAUDE_CWD` で起動していたので、ユーザーが作業ディレクトリを選ぶ必要が生じたのはグリッドが初めて。
- `docs/guide/*/basics.md` のランチャフォームの表 — WORKING DIRECTORY は「作業ディレクトリを入力」だけ。MCP トグルに至っては**表に行が無く**、Shell の段落で「シェルには MCP 登録が無いので消える」と存在だけ触れていた。
- `docs/guide/*/faq.md` — 該当の Q なし。

断片は設定リファレンスの奥にあった: `config.md` の設定表（`userMcpServers` の行）に「GUI MCP をフルで持つのは作業ディレクトリがワークスペースのセル」、環境変数表に `CLAUDE_CWD` / `MULMOCLAUDE_WORKSPACE_PATH`。
MCP トグル（ツールグループ）の説明は v2.8.0 のリリースページの Antigravity 節にしかない。

## 実装の根拠（コードで確認した挙動）

- `server/session/spawn-claude.ts` の `carriesFullGuiMcp(attachGuiMcp, cwd)` — **claude のセルは cwd が `CLAUDE_CWD` と一致するときフルの GUI MCP**（`--mcp-config` + `--strict-mcp-config`）を持つ。単一ビューと等価にするための規則だと、そのコメント自身が書いている。`userMcpServers` もこのときだけ合流する（同ファイル）。strict なのでそのディレクトリ自身の MCP 設定は読まない。
- `server/agents/claude-args.ts` — プロジェクトディレクトリのセルは `--mcp-config` も `--strict-mcp-config` も付けないので、ユーザー / プロジェクトの MCP 設定が普通に読まれ、登録済みのツールグループ（`mulmoterminal-<group>`）もそこに載る。
- `server/session/spawn-codex.ts` — **codex には claude のワークスペース規則を意図的に与えていない**（コメントに明記）。`server/routes/ws-routes.ts` の antigravity ハンドラも同様で、ディレクトリに登録されたグループだけ。→ 「MCP も適宜 enable して」が必要になるのはここ。
- `server/config/env.ts` の `CLAUDE_CWD` と `bin/cli-args.js` — 優先順位は `--cwd` > 環境変数 `CLAUDE_CWD` > 実行したディレクトリ（サーバ直起動時のみ `~/mulmoclaude`）。`bin/mulmoterminal.js` は起動時に `Workspace: <path>` を出す。
- `server/backends/workspaceSetup.ts` — プリセットスキル / help の配置は、既定の作業ディレクトリが管理下ワークスペース（`MULMOCLAUDE_WORKSPACE_PATH`、既定 `~/mulmoclaude`）のときだけ実行される。
- `common/toolGroups.ts` + `src/components/TerminalGrid.vue` — 拡大時に Canvas が出るかはセッションのツールグループ次第（`render` / `media`）。何も登録していないプロジェクトのセルでは Canvas が出ない。

## 変更（en / ja 両方）

1. `basics.md` — ランチャフォームの表に **MCP トグルの行**を追加。表の節の最後に新セクション **「どのディレクトリで起動するか — ワークスペースとプロジェクト」** `{#launch-dir}` を追加（claude / codex × ワークスペース / プロジェクトの表、単一ビュー相当の作り方、MulmoClaude の clone 先ではないという注意）。
2. `faq.md` — 「セルはどのディレクトリで起動すればいいですか？」を追加し、`basics.html#launch-dir` へ。
3. `glossary.md` — **ワークスペース**の項目を追加（用語集に無かった）。
4. `config.md` — 環境変数の見出しに `{#env}` を付与、`CLAUDE_CWD` の行と `userMcpServers` の行から `basics.html#launch-dir` へリンク、「やりたいことから探す」に「拡大しても Canvas が出ない」を追加。

## Codex レビューで直したこと

初稿を Codex に読ませ（read-only、実装との突き合わせ込み）、次を修正した:

- **ワークスペースの決まり方**。「`npx mulmoterminal` を実行したディレクトリ」は断定しすぎ。優先順位は `--cwd` > `CLAUDE_CWD` > 実行ディレクトリ（`bin/cli-args.js`）なので、「起動時の `Workspace:` 行が答え」に直した。
- **「GUI MCP は付かない」→「フルの GUI MCP は付かない」**。プロジェクトのセルでも、登録済みのツールグループは載る。
- **「トグルで登録したぶんだけ」→「そのディレクトリに登録されているぶんだけ」**。`registeredGuiMcpGroups` は local / project / user の 3 スコープを読む（`server/infra/gui-mcp-registration.ts`）ので、トグル以外の登録も効く。
- **Files はワークスペース固定ではない**。拡大セル横の Files ペインはそのセルのディレクトリを見る（`TerminalGrid.vue` の `expandedCwd`）。ワークスペース固定は Collections / Wiki / Accounting。
- 追記: どのトグルが何をもたらすか（`render` / `media` = Canvas、`data` = コレクションと帳簿、`external` = 外部アカウント）、トグルは次に起動するセッションから効くこと、ワークスペースを変えるならサーバの起動し直しが要ること。

## 決めたこと

- **`v4.0.0.md` は触らない。** 日付入りのリリースページは snapshot で、後から書き換えないのがこの repo の約束（CLAUDE.md）。今回の内容は生きたガイド（basics / faq / glossary / config）に置く。
- 画面のスクリーンショットは追加しない — 新しい UI ではなく、既存フォームの選び方の説明なので。
- 追加した文章は**文の途中で改行しない**。既存ガイドはカラム幅で折り返しているが、レンダラによっては折り返し位置で語が繋がって読めなくなるため、追加分は 1 文を 1 行に収めた。
