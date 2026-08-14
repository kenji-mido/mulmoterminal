# fix: grok / antigravity / muse のシードプロンプトが Windows で起動を壊す（#1518）

## User Prompt

> （#1516 の調査中に発見。publish 後に）続きやって！！
>
> appendSystemPrompt が原因で起動しない、appendSystemPrompt をサポートしないなら問題ないなら、
> 問題がある coding agent は appendSystemPrompt をサポートしない、というのもありだよ。
> そのうえで A でよい

## 診断

`grok` / `antigravity` / `muse` は `initialPrompt` を **argv に直接載せる**（grok と muse は positional、
antigravity は `--prompt-interactive` の値）。そしてシードを作る `codexifySkillSeed` 自身が改行を作る:

```ts
return rest ? `Use the "${slug}" skill.\n\n${rest}` : `Use the "${slug}" skill.`;
```

**引数付きスキルなら必ず多行**になるので、Windows の `.cmd` インストールでは毎回
`UnsafeArgumentError` で起動に失敗する。#1516 と同じバグ族。

## 検討して却下した案（B: TUI 打ち込み）

claude と codex は既にシードを argv に載せず TUI に打ち込んでいる（`attachDraftInjection` /
`attachCodexAutoRun`）。「同じ規則に3つも揃える」のが筋に見えたので**実際に実装して実機で試した**。

**動かなかった。** 実機の `agy` に対して:

| 計測 | 結果 |
|---|---|
| t=8s に固定で貼り付け | 成功（agy が Working... に入り、目印の文字列が届いた） |
| agy 起動中の無出力ギャップ | t≈2.4s から **3.9 秒** |
| codex 用の「1秒静穏」 | **t≈3.4s（起動途中）で打ってしまい、飲まれる** |
| `?forshortcuts` マーカー | 別 run では 3201ms — **起動タイミングが run ごとに揺れる** |

仕組みの形はエージェント非依存でも、**閾値は非依存ではない**。しかも `grok` と `muse` はこの環境に
無いので閾値を検証できない。リポジトリの戒め（"a guessed one silently types into nothing"）どおり、
失敗の仕方が静か（シードが実行されないだけ）で、今のクラッシュより気づきにくい。

なので B は取らない。

## 採る案（A: ファイル参照）

シードをファイルに書き、コマンドラインには**それを読めという1行**を渡す。タイミングの当て推量が
一切要らず、配送は CLI 自身が行う。#1516 で採った「引数に載せず、パスを渡す」と同じ形。

置き場所は `session-settings.ts` — `settingsArgument` / `mcpConfigArgument` /
`appendedPromptArgument` と同じモジュールで、掃除も孤児掃除も同じ経路に乗る。

### 適用範囲を最小にする

エージェントの最初の行動が「ファイルを読む」に変わるのは**実挙動の変化**なので、**直接渡しが
不可能なときだけ**にする:

```ts
const seedNeedsFile = (prompt, platform) => platform === "win32" && /[\0\r\n]/.test(prompt);
```

- Windows 以外 → 常に従来どおり（多行でもそのまま）
- Windows でも単行のシード → そのまま
- Windows ＋ 多行 → ファイル＋参照1行（＝今クラッシュしている唯一のケース）

「サポートしない」も選択肢として提示されたが、この3つでスキル起動が使えなくなるのは機能の欠落
なので、届けられる A を採る。

## 検証

- 横断テスト（`seed-prompt-not-argv.spec.ts`）: Windows の argv がコマンドラインに載ること、
  載せられない引数が1つも無いこと。**3エージェント分を1箇所で**述べる — 各エージェントの spec は
  シードの argv 位置を主張していて、それは規則ではなくバグの形のテストだった
- `seedPromptArgument` の単体テスト: Windows 以外は素通し / Windows でも単行は素通し /
  多行は1行に置き換わりファイルに verbatim で入る / 掃除で消える
- **旧配線に戻すと落ちる**ことを確認済み（issue と同じ `UnsafeArgumentError`）
