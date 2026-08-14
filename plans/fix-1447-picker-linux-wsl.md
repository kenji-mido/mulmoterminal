# fix(#1447): zenity を入れなくても Linux / WSL2 でファイル選択が動くようにする

## 問題

`server/files/pick-file.ts` の `pickFileCommand()` は darwin / win32 以外を **`zenity` 決め打ち**で
spawn する。zenity が無いホスト（WSL2 の Ubuntu、最小構成の Linux）では ENOENT でルートが 500 を
返すが、呼び出し側 3 箇所が全部 `if (!res.ok) return;` と `catch {}` でそれを捨てているため、
ユーザーからは **「押しても何も起きないボタン」** になる。

握りつぶしている 3 箇所:

| 箇所 | ボタン |
| --- | --- |
| `src/components/CellLaunchForm.vue` `pickDir()` | New terminal の Working directory 📁 |
| `src/composables/useHeaderAction.ts` `pickFileInto()` | ヘッダの "Insert a file path" |
| `src/components/settings/NotificationSoundsSection.vue` `browseSound()` | Settings の通知音の選択 |

## 同じ形のバグ（sweep して見つけた分）

「ホストのコマンドを spawn する / 失敗が UI に出ない / WSL が考慮されていない」で横に並べると:

1. **`server/files/open-dir.ts`** — 非 darwin/win32 は `xdg-open` 決め打ち。しかも spawn 失敗を
   `console.error` に書くだけで、レスポンスは先に `{ok:true}` を返している（`error` イベントは
   レスポンスの後に来る）。WSL では `xdg-open` が無い / Linux 側を開いてしまい、**UI 上は成功に見える**。
2. **`bin/mulmoterminal.js` `pickOpenCommand()`** — 起動時のブラウザ起動が `xdg-open` 決め打ち。
   こちらは失敗すると `Open your browser: <url>` を出すので沈黙はしないが、WSL では自動で開かない。

音の再生はブラウザ側（AudioContext）なのでホスト依存なし。他の spawn（git / gh / tmux / pty）は
GUI を開かないので対象外。

## 方針

**追加インストールを要求しない = OS 標準でできるのが好ましい**（ユーザー方針）。

- **WSL2 → Windows 側のダイアログ**。WSL からは interop で `powershell.exe` がそのまま実行できるので、
  既存の Windows 用スクリプト（COM の Explorer 型フォルダダイアログ / `OpenFileDialog`）を流用する。
  返り値は Windows パスなので `wslpath -u` で Linux パスへ変換する。**zenity 不要**。
- **素の Linux → フォールバックチェーン** `zenity` → `kdialog` → `qarma` → `yad`。
  厳密な "OS 標準" は xdg-desktop-portal の `org.freedesktop.portal.FileChooser` だが、結果が D-Bus の
  Response シグナルで非同期に返る仕様で `gdbus` 一発では取れず、常駐監視か D-Bus ライブラリ依存が要る。
  コスト対効果でチェーン方式にする。
- **全滅したらエラーを UI に出す**。これはプラットフォームを問わず必須。

## 実装

### 1. `server/files/wsl.ts`（新規）

- `isWsl(platform, env, kernelRelease = os.release())` — 純関数。判定は 2 段:
  1. `WSL_DISTRO_NAME` / `WSL_INTEROP`（WSL が**ログインシェル**に撒く変数。ドキュメント化された正攻法）
  2. カーネル名（`…-microsoft-standard-WSL2` / WSL1 は `…-Microsoft`）。**systemd 等で起動され変数が
     届かないプロセス**が「素の Linux」と誤判定されるのを防ぐ。これが漏れると zenity の無い WSL で
     今回の修正が丸ごと効かない。
  - **WSL1 と WSL2 は区別しない**。どちらも interop と `wslpath` を持ち、欲しいものが同じ。
  - 誤検出のコストは設計で下げる: どの呼び出し側も Windows 側コマンドが起動できなければ Linux 側へ
    フォールバックするので、**誤検出は ENOENT 1 回**、取りこぼしは機能喪失。非対称なので前者に倒す。
- `toLinuxPath(windowsPath, run?)` / `toWindowsPath(linuxPath, run?)` — `wslpath -u` / `-w`。
  `run` を差し替え可能にしてテストする。

**判定は端で 1 回だけ**行う。ルートが `isWsl()` を呼び、以下の純関数には `wsl: boolean` という
**決定済みの事実**を渡す（`pickFileCandidates` / `openDirCommands` / `pickerUnavailableMessage`）。
env を各所で読み直さないので、判定箇所が 1 つに固定され、テストもホスト非依存になる
（WSL 上でテストを回しても「Linux はチェーン」を検証できる）。

### 2. `server/files/pick-file.ts`

- `pickFileCommand()` → **`pickFileCandidates(platform, directory, env)`**（候補の配列）に変える。
  - darwin: `osascript`
  - win32: `powershell`
  - WSL: `powershell.exe`（+ `appendWindowsPath=false` 向けに絶対パスの `/mnt/c/...` を 2 番目）→ Linux チェーン
  - その他 Linux: zenity → kdialog → qarma → yad
- ルートは候補を順に試し、**「起動できなかった / 起動したが失敗した」候補だけ**次へ送る。
  判定は純関数 `classifyPickerRun()` に出してテストする:
  - spawn error（ENOENT 等）→ 失敗
  - `code !== 0 && stdout 空 && stderr 非空 && ユーザーキャンセルでない` → 失敗
  - それ以外 → 成功（**キャンセルは成功で `paths: []`**）
  - macOS のキャンセルは `osascript` が stderr に `User canceled. (-128)` を出して exit 1 になるので、
    候補ごとに `isUserCancel` を持たせる。ここを間違えると **キャンセルするたびにエラーが出る**。
- WSL 候補の stdout は Windows パスなので、`path.isAbsolute` フィルタの **前に** `wslpath -u` を通す。
  （`C:\proj` は posix では絶対パスではないため、順序を間違えると全部落ちて「キャンセル」と同じになる）
- WSL 候補は `-Command` ではなく **`-EncodedCommand`**（base64 UTF-16LE）でスクリプトを渡す。
  interop の argv→コマンドライン変換で here-string の引用符・改行が壊れるのを避けるため。
  win32 の既存経路は**触らない**（実機で動いている挙動を変えない）。
- 全滅時は 500 + プラットフォーム別の案内文（`pickerUnavailableMessage()`、純関数）。

### 3. `server/files/win-folder-dialog.ts`

初期フォルダを渡せるようにする（`IFileDialog.SetFolder` + `SHCreateItemFromParsingName`）。
WSL では `wslpath -w $HOME` を渡し、Windows のダイアログが `\\wsl.localhost\<distro>\home\...` から
開くようにする。これが無いと Windows 側の既定位置から手で UNC を辿ることになり実用にならない。
**win32 は初期フォルダ無し（＝現行と同じ argv）**。SetFolder は独自の try/catch で囲み、失敗しても
ダイアログ自体は開く。

### 4. `server/files/open-dir.ts`

- こちらも**候補チェーン** `openDirCommands(platform, wsl)` にする。WSL は
  `explorer.exe <windows path>`（`wslpath -w` で変換）→ `xdg-open`。1 発勝負にすると WSL 誤検出が
  「動いていた `xdg-open` を壊す」ことになるため、フォールバックを必ず後ろに置く。
  `explorer.exe` は成功時も exit 1 を返すことがあるので終了コードでは判定しない。
- レスポンスを `spawn` イベント（成功）/ `error` イベント（失敗）まで待ってから返し、全滅は 500 にする。
  UI 側（`TerminalCell.vue` / `useHeaderAction.ts`）でも握りつぶしをやめる。

### 5. UI: 共有ヘルパー `src/composables/pickPaths.ts`（新規）

`pickPaths({directory})` → `{ paths, error }`。3 箇所の fetch + パース + エラー処理を 1 つにまとめる。
表示先:

- `CellLaunchForm.vue` — Working directory 欄の下（`cell-dir-busy` と同じ amber 行）
- `NotificationSoundsSection.vue` — サウンド欄の下（`GoogleAccountSection` の `google-warn` と同じ形）
- ヘッダボタン — `Terminal.vue` の既存の**セル内トースト** `showHint()` を使う。
  `runHeaderButton()` に `onError` を渡す形にする。

### 6. `bin/mulmoterminal.js`

- `PATH_TOOLS` にファイルダイアログの依存を**プラットフォーム別に**足す
  （darwin/win32 は不要、WSL は `powershell.exe`、素の Linux は `zenity`）。
- `pickOpenCommand()` を WSL 対応（`explorer.exe`）。

### 7. ドキュメント

- README の要件表に 1 行（tmux / glab と同じ扱い）と、ファイルダイアログの節に説明。
- `docs/guide/{en,ja}` は要件表を持たないので、リリース時のガイドページで触れる（本 PR では触らない）。

## テスト

- `test/server/files/wsl.spec.ts`（新規）— 検出とパス変換。
- `test/server/files/pick-file.spec.ts` — 候補の順序、WSL 分岐、`classifyPickerRun`（**キャンセル 3 種**:
  zenity exit 1 / osascript -128 / PowerShell exit 0 空 stdout）、変換→絶対パス判定の順序、案内文。
- `test/server/files/open-dir.spec.ts` — WSL 分岐と失敗時 500。
- `test/src/composables/pickPaths.spec.ts`（新規）— 500 / 例外 / 正常。
- 既存の 3 コンポーネント spec にエラー表示のケースを足す。

## macOS 実機で確認できたこと

- `/api/open-dir` → Finder が開き 200。`/api/pick-file` → 実際にダイアログが出る（`osascript`
  プロセスを確認）、閉じると 200 `{"paths":[]}`。**キャンセルがエラー表示にならない**。
- この機体でバックグラウンドから出したダイアログは自動キャンセルされ、実出力は
  `22:63: execution error: ユーザによってキャンセルされました。 (-128)` だった。
  **文言はロケールで翻訳される**ので、英語文言ではなく `(-128)` で判定しているのが効いている
  （判定を入れていなければ、ここで 500 が画面に出ていた）。この実出力を spec に固定した。

## 検証できないこと（PR に明記する）

**WSL2 / Windows の実機がない。** `wslpath` の UNC 変換、interop 経由で PowerShell のダイアログが
実際に開くか、`explorer.exe` の挙動は**未検証**。issue 報告者に確認を依頼済み（#1447 のコメント）。
コードは「WSL 候補が失敗したら Linux チェーンへ、それも全滅ならエラー表示」と degrade するので、
最悪でも現状（無反応）より悪くはならないようにする。
