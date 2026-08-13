# feat: ランチャーに workspace のチップを常に出し、区別して表示する

## きっかけ

「workspace は特別な場所なのだから、チップの見せ方を変えて、ランチャー UI に既定で出すべき」
（オーナー判断 2026-08-03）。

#1355 / #1358 で確定した通り、workspace は**全 GUI ツールに届く唯一のディレクトリ**
（サーバー側 `carriesFullGuiMcp`）。にもかかわらず UI 上は「最近使ったディレクトリ」の 1 つでしか
なかった。

## 直前の状態

チップの一覧は `cwdPresets` そのもの。これは `recordPreset` が**起動したときに自動記録する**リストなので:

- workspace で一度も起動していなければ、チップは**存在しない**
- チップの × でユーザーが消せる（消したら二度と出ない）

つまり「最も重要なディレクトリが、クリックできないかもしれない」状態だった。

## 変更

**`launchChips(orderedPresets, defaultCwd)` を `src/components/presets.ts` に追加。** 純関数で、

- workspace を**常に先頭**に置く（`orderByDirPriority` の外側 — あれはユーザーが設定した
  ディレクトリ同士の順位であって、workspace はその競争に参加していない）
- すでに presets に含まれていれば**重複させず**、そのラベルを維持する
  — **後に撤回。** 下の「表示」を参照: ラベルは常に `WORKSPACE` になり、同じパスにユーザーが
  付けた名前があっても役割名が勝つ（`presets.spec.ts` がその上書きを assert している）
- `isWorkspace` フラグを付けて返す
- `defaultCwd` が null（`/api/config` 未解決）のときは何も足さない — 誰も選んでいない
  ディレクトリにクリック先を作らないため

パス比較は `common/dirPathKey.ts` の **`isSameDirPath`** を使う。同ファイルが worktree 行で使って
いるのと同じ字句比較で、末尾スラッシュや `..` を畳む。ブラウザは symlink を解決できないので
ここは「同じ綴りか」までしか答えない — 本当の判定はサーバーの realpath（`isWorkspaceCwd`）。
外した場合の被害は「同じディレクトリが 2 回出る」だけ。

**表示（`CellLaunchForm.vue`）:**

- ラベルの前に Material Symbols の `workspaces` アイコン
- ラベルは **`WORKSPACE`**（大文字）。当初は「ラベルはそのまま」で入れたが、オーナー判断で役割名に変更。
  隣が全部小文字の basename なので、大文字はディレクトリ名として読まれないための区別でもある。
  実パスは hover に残る（他のチップと同じ場所）。**読み上げ**だけは `the workspace, <path>` にする —
  他のチップはラベルがそのままディレクトリだが、この 1 つだけは役割名で、行き先を言っていないため
- **× ボタンを出さない** — 合成されたエントリなので消すものが無く、消しても次の描画で戻る
- hover / aria-label に「the workspace: every GUI tool is available here」を足す。アイコンだけでは
  *なぜ*特別なのかが言えず、他にそれを言う場所が画面上に無いため
- **枠と背景は触らない。** あの 2 つは既に「ここでセッションが走っている」という意味を持っており
  （#1106 でまさにその二重化がバグとして報告された）、同じ 2 つに別の意味を重ねない
- 色ストライプは通常どおり — workspace にも `.mulmoterminal.json` はある

## 実装上の落とし穴

`presetPaths`（`useDirColors` に渡す）が `chips` を参照するので、**`chips` を先に宣言しないと
マウント時に TDZ で throw する**。`useDirColors` は watch で即座に評価するため、computed の遅延評価
では守られない。

## 既存テストへの影響

チップを**位置で選んでいた**テストが 5 本落ちた。workspace が先頭に入ったため。これは仕様変更が
正しく現れたもので、いずれもパス指定で選ぶよう直した（`chipForPath` / `launchButtonFor` ヘルパー）。
1 本は「`my-project` は "proj" を含む」ため、ラベルの部分一致ではなくパスの前方一致にしている。

Material Symbols は**アイコン名がそのままリガチャのテキスト**なので、`text()` は
`"workspacesws"` を返す。テスト側はアイコン要素を引いて差し引く。

## workspace では選ばせるものが無い（追加）

同じ理由がランチャーの他の 2 か所にも及ぶ。

**1. GUI ツールグループのスイッチ 4 つを出さない。** workspace のセッションは、どのエージェントでも
spawn 時に**全 GUI MCP を 1 本の URL で受け取る**（`carriesFullGuiMcp`）。ここでスイッチを出すのは
冗長どころか有害で、書き込む先は per-folder のレジストレーションであり、`--strict-mcp-config` が
それを無視する — つまり**見た目上何もしないコントロール**になる。代わりに「全部使える」と表示する:

```
GUI TOOLS
(icon) All of them, automatically — Canvas, Workspace data, External accounts.
       The workspace needs no per-directory registration.
```

グループ名は `TOOL_GROUP_HEADINGS` から導出し重複を除く（render と media はどちらも "Canvas"）ので、
グループを足しても二重編集にならない。判定は**フィールドの文字列ではなく起動に使うディレクトリ**
（`targetDir`）で行う — 空欄は workspace を意味するため、生の入力と比べると取りこぼす。

**2. worktree セクションを出さない。** worktree は 1 つのコードベースの作業をブランチに隔離する
仕組みで、workspace はセッションが**作業の拠点にする**場所（共有の wiki / collections / accounting が
あるところ）。切り離されたブランチはまさにそこから切断する。git リポジトリであっても出さない。

## 既存テストへの影響（追加）

さらに 15 本が落ちた。いずれも `dir == defaultCwd` でマウントしており、**そのセルは workspace だった**
ため。仕様変更が正しく現れたもので、対応は 2 つ:

- `CellLaunchForm.spec` の `mountForm` の既定 `defaultCwd` を `/repo` から `/home/me/ws` に変更。
  代表的なケースは「プロジェクトディレクトリ」であって workspace ではない
- `TerminalCell.spec` に `mountProjectCell(dir)` を追加し、**ツールグループと worktree のテストだけ**
  そこへ寄せた。最初は一括置換したが、7 本は MCP と無関係（セッション一覧・スクリプト・record-cwd）
  で、それらの `defaultCwd` を変えるとテストの意味が変わるため戻して個別に当て直した

## 検証

`yarn typecheck` / `format` / `lint`（0 errors）/ `yarn test` 7751 passed、`yarn build` 成功。
**実ブラウザでの確認は未実施**（この環境に Playwright が無いため）。
