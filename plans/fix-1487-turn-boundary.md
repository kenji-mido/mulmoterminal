# claude のターン境界を推測せずに読む — #1487

## 何が起きたか

3席のラウンドテーブルを実機で回したら、3人目の発言が

```text
I'll read the actual files before weighing in.
```

だけで確定され、40秒後に書かれた本題が部屋に入らなかった。後続の席はこの前置きしか読めず、
「全員合意」で終了した。失われた本文には**両者への反論**が入っていた。

## 原因

`lastTurnFromClaudeParsed` は、アシスタントの散文レコードが1つ来た時点で
`lastComplete` を更新する。Claude Code はツールを呼ぶ前に前置きを1レコード出すので、
そこがターンの終わりとして扱われる。

境界自体は記録されている（`stop_reason`）。このファイル自身の方針
「a turn boundary that is recorded rather than guessed」に反していたのは実装のほうだった。
codex 側は `task_complete` を読んでいるので無傷。

実 transcript 12本・散文レコード 1957件のうち **1524件 (78%) が `tool_use`** =
ターン継続中。ツールを使ってから答えるターンはすべて対象。

## 直し方

- `ConversationTurn` に `endsTurn` を足し、アシスタントレコードの `stop_reason` から立てる。
  `tool_use` **だけ**が「まだ続く」。`end_turn` / `stop_sequence` / `max_tokens` は終わり。
- `stop_reason` が無いレコードは**終わり扱い**。逆に倒すとターンが永久に完了せず、
  exchange が必ずタイムアウトする — 現状維持側に倒すほうが安全。
- `lastTurnFromClaudeParsed` は `endsTurn` のターンだけを完了として記録する。
- `conversationTurnsFromParsed` の他の利用者（ロスターの「いま何を言っているか」、
  タイトル要約）は**途中発言が欲しい**ので、`endsTurn` を無視する＝挙動は変わらない。

## テスト

- 前置き（`tool_use`）→ ツール →結論（`end_turn`）の並びで、**結論**が返ること
- 前置きだけ書いてまだ動いている最中は、**ひとつ前の完了ターン**が返ること
- `stop_reason` が無いレコードは完了として扱われること（現状維持）
- ロスターの `latestAssistantTextFromParsed` は途中発言を返し続けること（回帰防止）
- 実機の3席テーブルで、3人目の本題が部屋に入ること（これが本題）

## やらないこと

`appendSystemPrompt`（クロージングサマリ）が部屋の投稿の半分以上を占める件は別。
#1456 側に書く。
