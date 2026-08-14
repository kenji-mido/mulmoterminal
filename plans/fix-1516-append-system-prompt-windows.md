# fix: Windows で appendSystemPrompt が Claude セッションを起動不能にする（#1516）

## User Prompt

> https://github.com/receptron/mulmoterminal/issues/1516
> 現象を ci 上で調査して、対策できるなら対策をしてほしい。windows の特定の条件のときに、、。
> CR・LF・NUL を append-system-prompt で escape すればよい？ escape の副作用ってないかな？
> きちんと調べて adhoc じゃなくて根本を直してね

## 質問への回答: escape はできない。そして「代用」には副作用がある

**Windows のコマンドラインには CR・LF・NUL を表す方法が存在しない。** CR/LF は行を終わらせ、NUL は
文字列を終わらせる。cmd.exe の `^` は行継続であって、改行を引数の中に入れる手段ではない。つまり
`escapeBatchArgument` に「エスケープ規則を足す」という直し方は取れない。あの throw は正しい。

やれるのは escape ではなく **置換**（改行を `\n` というリテラルや空白に変える）で、これには副作用が
ある:

- 渡している本文は markdown（見出し・箇条書き・段落）で、改行を潰すと**別の文章**になる。箇条書きが
  1行に連結され、見出しが本文に混ざる
- system prompt は「エージェントへの指示」なので、内容が変わるとは**指示が変わる**ということ。これは
  `cmd-escape.ts` が明示的に避けている失敗そのもの:
  「Thrown rather than silently mangled: a truncated argument reaches the agent as a DIFFERENT
  instruction.」
- しかも壊れ方が静か。起動は成功するので、誰も気づかないまま全 Windows セッションが変質した指示で
  走る。今の「起動に失敗する」より悪い

なので根本の直し方は「引数に載せるのをやめる」。

## 根本原因: このリポジトリには既に規則があり、この1箇所だけ従っていない

`server/session/session-settings.ts` に同じ問題の答えが既にある:

> Windows has a second, unrelated reason to use a file: there, a `.cmd`-installed Claude is
> launched through cmd.exe (#798), so a JSON argument is parsed by cmd and then by the child's
> CRT, and the two disagree about quoting. **A path has no quotes and no metacharacters, which
> removes that layer rather than escaping through it** (#813).

`--settings`（#579, #813）と `--mcp-config` は Windows でファイル渡しになっている
（`mustUseFile = secret || platform === "win32"`）。

`--append-system-prompt` は #942 で後から追加され（mulmoterminal v2.3.0）、**この規則に従わなかった
唯一の引数**。しかも中身は既定で 44 行・2562 文字の複数行プリセットなので、Windows の `.cmd`
インストールでは必ず落ちる。報告どおり v2.3.0 以降ずっと再現する。

`claude-args.ts` には inline を選んだ理由が書かれている:

> Inline, not --append-system-prompt-file: the sandbox spawn runs in a container that cannot
> read a host path

**この前提は既に消えている。** Docker sandbox は #1195（`6752e1a8 feat: remove the Docker sandbox`）で
削除済み。理由が無くなったまま選択だけが残っていた。

## 事実確認したこと

- `--append-system-prompt-file` は実在し、**複数行ファイルを読む**（claude 2.1.223 で実測。印を仕込んだ
  ファイルを渡して応答が変わることと、フラグ無しでは変わらないことの両方を確認）
- 追加時期は claude **2.0.0 → 2.1.0 の間**（npm の各版の `cli.js` を grep して確認）。それより古い
  claude では未知のフラグになるが、**そのユーザーは今すでに起動できない**ので後退にはならない
- 再現はプラットフォーム非依存に書ける。`resolvePtyLaunch` は platform と `fileExists` を注入できるので、
  macOS 上で `UnsafeArgumentError` を再現できた

## CI 側の穴

Windows CI は**存在し、`yarn test` まで回って green**（`.github/workflows/windows-daily.yaml`）。
PR の matrix は ubuntu/macOS のみだが、**今回の見逃しはそこではない** — この不変条件を検査する
テストが1つも無かった。

だから追加するテストは Windows ランナーを必要としない形にする。platform を注入すれば
**PR ごとの ubuntu/macOS の CI で落ちる**。日次 Windows ジョブを待つ必要はない。

## 修正

### 1. `session-settings.ts` — 規則を持っているモジュールに追加する

`appendedPromptArgument(sessionId, prompt, platform)` を `settingsArgument` / `mcpConfigArgument` の
隣に置く。inline か file かを決めるのはこのモジュールの役目で、`mustUseFile` をそのまま使う。

フラグ名は `claude-args.ts` に残す（`--append-system-prompt` と `--append-system-prompt-file` は
別フラグなので、値だけでなく「どちらか」が伝わる必要がある）。判別可能な値を返す。

### 2. `sessionIdFromFileName` に新しい名前を教える

今は `.json` 固定で `-mcp` だけを剥がす。プロンプトファイル（`.txt`）を足すと**孤児掃除の対象から
漏れる**。`cleanupSessionSettings` にも追加する。

一度「拡張子の集合 × 接尾辞の集合」という直積で書いたが、これは Codex レビューの指摘どおり**広すぎた**:
こちらが一度も書かない `<id>.txt` まで一致してしまい、「自分が書いたものだけ消す」という既存の不変
条件を弱める。**書く名前そのもの**（`<id>.json` / `<id>-mcp.json` / `<id>-prompt.txt`）を列挙する形に
直した。

### 3. `claude-args.ts` — 受け取った形に応じてフラグを置く

pure builder のまま。ファイルを書くのは `session-settings.ts` の `appendedPromptArgument` 自身で、
`settingsArgument` / `mcpConfigArgument` と同じ。`spawn-claude.ts` はそれを**呼ぶ**だけで、書き込みは
しない — 既に他の2つを呼んでいるのと同じ位置に並べる、という意味。

## テスト

- **回帰テスト（落ちることを確認してから直す）**: 既定の appendedSystemPrompt → `buildClaudeArgs` →
  `resolvePtyLaunch(platform: "win32", .cmd shim)` が throw しないこと
- **横断テスト**: Windows の spawn が作る引数の**すべて**がコマンドラインに載せられること。将来
  複数行を運ぶフラグが増えたら、ユーザーではなくテストが落ちる
- `appendedPromptArgument` の単体テスト（win32 はファイル・パスを返す / それ以外は inline）
- プロンプトを改行込みで verbatim に書くこと
- **消える経路すべて**: reap（`cleanupSessionSettings`）、spawn 失敗（`withSettingsCleanup`）、
  起動時の孤児掃除（`pruneOrphanSettings`）
- 書かない名前（`<id>.txt` / `<id>-prompt.json` / `<id>-other.txt`）を掃除しないこと
