# fix(windows): フォルダ/ファイル選択が非ASCIIパスで壊れる（#1146）

Issue: #1146 / Branch: `fix/1146-windows-picker-utf8`

## User Prompt

https://github.com/receptron/mulmoterminal/issues/1146 これって対応でできる？win/mac や CJK などの対応も必要（というか多言語）

## 症状と原因

日本語 Windows で 📁 ボタンから日本語名のフォルダを選ぶと、ターミナルが**デフォルトパスで**起動する。

1. `pick-file.ts` は picker の stdout を `Buffer.concat(out).toString()`（= UTF-8）で復号する。
2. しかし `child_process.spawn` された Windows PowerShell 5.1 は、コンソールを持たないパイプ出力を
   **OEM コードページ**（日本語 Windows なら CP932）で書く。→ 非ASCII部分だけ化ける。
3. `C:\` の ASCII 前置は生き残るので `parsePickerOutput` の `path.isAbsolute` を通過し、
   壊れたパスが `?cwd=` として送られる。
4. `existingWorkspace` の `statSync` が ENOENT → `resolveWorkspace` が無言で `CLAUDE_CWD` に差し替える。

つまり **CJK 固有ではなくコードページ依存**。中文・한국어・キリル・アクセント付きラテン（café）も同経路で壊れる。

## mac / Linux は影響なし（実測）

macOS 上で `osascript -e 'return POSIX path of (POSIX file "…" as alias)'` の stdout バイトを確認:

| ディレクトリ | stdout バイト |
| --- | --- |
| `パソコン` | `e38391 e382bd e382b3 e383b3`（UTF-8 / NFC） |
| `中文目录` | `e4b8ad e69687 e79bae e5bd95` |
| `café` | `636166 c3a9`（NFC のまま） |

UTF-8 で、APFS 上では NFC も保持される。zenity も UTF-8。よって本件は **Windows 固有**。
（HFS+ ボリューム等で NFD が返るケースは `statSync` は通る＝起動はするので、本 PR の対象外。）

## 修正

1. PowerShell に UTF-8 で出力させる prelude を 1 箇所に切り出し、**フォルダ picker とファイル picker の両方**に適用する。
   ファイル picker（`OpenFileDialog`、通知音の選択・header の `open` + `pickFile`）も同じバグを持つ。
2. `[System.Text.Encoding]::UTF8` は **使わない**。BOM 付きなので、ホストによっては stdout 先頭に
   `EF BB BF` が出て `\uFEFFC:\…` になり、`path.isAbsolute` が false → `paths: []`
   （＝「選んでも何も起きない」）で全ロケールを巻き込む回帰になる。`New-Object System.Text.UTF8Encoding $false` を使う。
3. Node 側の BOM 耐性は `parsePickerOutput` の `.trim()` が既に担っている
   （U+FEFF は ECMAScript の WhiteSpace なので trim が落とす）。**偶然に頼らないよう spec で固定**し、
   なぜ trim が load-bearing なのかをコメントに残す。冗長な二重除去は入れない。

## 検証

`windows-daily.yaml` が windows-latest で `yarn test` を回しているので、Windows 実機の spec を追加する
（`it.skipIf(process.platform !== "win32")`）。英語ランナーでも先に
`[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(932)` を入れれば日本語 Windows を再現できる:

- prelude **あり** → 多言語パスが byte 単位で round-trip する。
- prelude **なし**（対照） → 化ける。＝ このテストが回帰を実際に捕まえられることの証明。

PowerShell に渡す文字列は `[char]0x…` の連結で組み、argv のエンコーディングを変数から外す
（テスト対象を stdout のエンコーディングだけに絞る）。

## 対象外（別 issue）

- 解決できない `?cwd=` を `resolveWorkspace` が**無言で**デフォルトに差し替える件。
  本件の発見を遅らせた本質だが、reattach など広い範囲が現在の意味論に依存しているので独立して設計する。
- picker のダイアログタイトル（`"Select folder"`）の i18n。PowerShell / AppleScript への
  クォート埋め込み（現状「定数のみ・補間なし」）を崩すので別扱い。
