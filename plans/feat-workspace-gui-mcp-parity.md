# feat: workspace では起動方法によらず同じ GUI ツールに届くようにする

#1355 の直後、`mt` がどの経路で渡っているかを追った際に見つかった 2 つのズレ。オーナー判断
（2026-08-03）で「workspace セルはエージェント非依存」に倒す。

## 直前の状態

`carriesFullGuiMcp` は claude セルしか見ていなかった。同じ workspace ディレクトリで:

| 起動方法 | 届いていたもの |
| --- | --- |
| claude セル（`?gui=0` でも） | `mt` = 全ツール |
| codex セル | ディレクトリが登録したグループのみ |
| ランチャーチップ `claude` | **何もなし**（Canvas が出ない） |
| ランチャーチップ `codex` | グループのみ |

隣り合ったセルが、エージェントが違うだけで到達範囲が違う状態だった。

## 変更

**0. `carriesFullGuiMcp` を `spawn-claude.ts` → `mcp-config.ts` へ移動。** 呼び出し側が 3 つに
増えたため（claude の argv / codex の `-c` / チップのコマンド行）。claude が唯一の呼び出し元
だった頃のローカルな都合でそこにあっただけで、今は「誰が何を受け取るか」を決める場所に置く方が
正しい。spawn-codex が spawn-claude を import する形も避けられる。

**1. codex セル（旧「意図的に対象外」）。** `allTools: attachGuiMcp` →
`allTools: carriesFullGuiMcp(attachGuiMcp, cwd)`。

これは実質的な拡大で、コメントにもそう書いた: **codex はサーバー単位承認**なので、その URL に
乗っているものが一括で自動承認される — google / X（外部アカウント）、有料の生成、そして
**どのグループにも属さない `spawnBackgroundChat`**（= all-tools URL でしか到達できない）。
ただし同じセルの claude では全部すでに自動承認されており、閉じたのはその非対称性。

**2. ランチャーチップの `claude`。** チップはユーザーが書いたコマンド文字列をログインシェルで
実行するだけなので、argv がない。codex 用に既にある `launcherCommandWithGuiMcp` と同じ方式で、
`launcherCommandWithClaudeGuiMcp` がプログラム直後に 3 つのフラグを差し込む:

```
claude --mcp-config <path> --strict-mcp-config --allowedTools <list>
```

- **JSON ではなくパス。** 数百バイトの JSON をシェル文字列に通すのは引用符の問題しかないので、
  `mcpConfigFileArgument` を追加して常にファイルへ書く（Windows 限定だった `mcpConfigArgument`
  と同じファイル名なので、reap の `cleanupSessionSettings` がそのまま消してくれる）。
- **`--strict-mcp-config` は意図的に入れる。** これでユーザー自身の MCP サーバーはそのターミナル
  では読まれなくなる。チップとセルで持ちツールが変わるのを避けるための代償で、オーナー判断。
  この点は README にも明記した。
- **新規スポーンのときだけ。** tmux 再アタッチは走っているプログラムを拾って `command` を無視
  するので、読まれないファイルを書き残さない。
- **素の `claude` しか認識しない。** ユーザーが書いたテキストを書き換える処理なので、ラッパーや
  `FOO=1 claude` は触らない（codex 側と同じ方針・同じ recogniser）。

両 rewriter に同じコマンドを通すが、それぞれ自分のプログラムしか認識しないので同時には発火しない。
プログラム直後への挿入ロジックは `insertAfterProgram` として共通化した（codex は clap がサブ
コマンド前にグローバルオプションを要求し、claude は末尾の `--add-dir` が可変長なので、どちらも
「直後」でなければならない）。

## レビュー指摘への対応（codex-review / CodeRabbit、いずれも同じ 2 点）

**A. `codex` チップが `allTools: false` のままだった。** PR 説明の表では「workspace の codex チップも
`mt`」と書いていたのに、コードを直していなかった。**説明と実装が食い違っていた**ので、
`allTools: carriesFullGuiMcp(false, cwd)` に修正。

**B. config ファイルを claude と確定する前に書いていた。** workspace のチップなら `zsh` でも
`yarn dev` でも `<session>-mcp.json` を書いてしまい、さらに launch 経路は `withSettingsCleanup` を
通っていないので spawn 失敗時に孤児になる。→ `launcherProgram(command) === "claude"` を確認して
から書くようにし、spawn を `withSettingsCleanup` で包んだ（`startAndWire` が rethrow を捕まえるので
ブラウザへのエラー表示はそのまま）。

**C.（自分のドキュメントが嘘だった）** `--strict-mcp-config` は「ユーザー自身の MCP を無効化する」と
書いていたが、`mcpConfigJson` は `userMcpServers` を**ペイロードに含めている**ので、それらは読まれる。
実際に落ちるのは project ディレクトリの per-folder `.mcp.json` の方。

修正方向として「GUI 専用ペイロードを作って除外する」案も提示されたが、**それは parity を壊す**
（セルでは読まれるため）。したがって直したのは実装ではなく記述の方。あわせて、セル側だけが行っていた
「ユーザーサーバーの id を `--allowedTools` に足す」処理を `fullGuiAllowedTools` として共通化し、
チップでも同じ承認になるようにした — 2 箇所に同じ join を書くのは、まさに今回のドリフトの再生産なので。

## 変えていないもの

project ディレクトリは**全経路で完全に据え置き**。`full-gui-mcp.spec.ts` がその不変条件を
assert している（チップの `null` ケースを含む）。

## 検証

`yarn typecheck` / `format` / `lint` / `test` 7733 passed（+10）。
