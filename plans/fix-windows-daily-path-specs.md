# fix: Windows (daily) の 4 件のパス依存テスト（#1459）

`Windows (daily)` が main で連続失敗している。lint / typecheck / build は green で、
落ちるのは `yarn test` の 3 ファイル・4 テストだけ。22.x / 24.x で同一。
最新の失敗: https://github.com/receptron/mulmoterminal/actions/runs/30984995312

Windows は PR では回らない（`windows-daily.yaml` は `pull_request` に入っていない）ので、
3 件とも「macOS で書かれ、macOS でしか実行されないまま main に入った」もの。

## 1. `test/server/config/dir-icon-detect.spec.ts` — `ref` の区切り文字

```
expected 'public/favicon.png' to be 'public\favicon.png'
```

`detectDirIcon` が返す `ref` は `ICON_CANDIDATES` の定数そのもの（`"public/favicon.png"`）。
テストだけが `path.join("public", "favicon.png")` を期待していて、Windows では `\` になる。

同じファイルの manifest 側のテストは Windows でも通っていたが、それは**実装が
`path.join(manifestDir, entry.src)` を使っていて、Windows では `public\big.png` という
`ref` を作っていたから**。`ref` は「書かれたとおりのパス」として設定ファイルに載る値
（`dir-icon.ts` の型コメント、`worktree-dir-config.ts` の継承）なので、プラットフォーム依存の
区切り文字が入るのは筋が悪い。

対応:

- 実装: manifest 分岐を `path.posix.dirname` / `path.posix.join` にし、この関数が返す `ref` を
  全プラットフォームで `/` 区切りに統一する。`resolveIconFile` の `path.resolve` は Windows でも
  `/` を受けるので解決結果は変わらない（`../` の脱出も従来どおり `isWithin` で弾かれる）。
- テスト: `ref` の期待値を `path.join` ではなく素の文字列リテラルにする（9 箇所）。

## 2. `test/server/config/dir-local-config.spec.ts` — drive-less な絶対パス

```
expected 'D:\work\proj' to be '\work\proj'
```

テストが `/work/proj/...` を渡している。Windows では `\work\proj` は「絶対だがドライブ無し」
なので、`writtenFilePath` の `path.resolve` がカレントドライブを足して `D:\work\proj` を返す。

姉妹テスト `dir-config.spec.ts` の `dirConfigWriteTarget` 群は同じ理由で
`path.resolve("/Users/me/proj")` と書かれている。そちらに合わせる。

## 3. `test/server/config/worktree-env.spec.ts` — 8.3 短縮名

```
expected {} to deeply equal { PORT: '3000' }
```

クロスプロセスのレースを再現するため、この spec だけが log ファイルへ直接
`{ dir: competitor, ... }` を append する。ところが spec の temp dir は `realpathSync`（JS 版）
で解決していて、production の `canonicalPath` は `realpathSync.native`。Windows の 8.3 短縮名
（`C:\Users\RUNNER~1\...`）は native でしか展開されないため、書いた `dir` と
`reservedWorktreeEnv` が引く正規化済みパスが別物になり、読み戻しが空になる。

`test/support/tempDir.ts` の `makeTempDir` がまさにこのために `.native` を使っている（#1052）。
この spec だけがそれを迂回していたので、`makeTempDir` に寄せる。

## 検証

- macOS: `yarn format` / `lint` / `typecheck` / `build` / `test`（全 592 ファイル）
- Windows: ブランチに push したうえで `gh workflow run windows-daily.yaml --ref <branch>` を実行し、
  実機 green を確認してからマージする（macOS だけの green は今回の失敗の原因そのものなので、
  ground truth は Windows ランナーで取る）
