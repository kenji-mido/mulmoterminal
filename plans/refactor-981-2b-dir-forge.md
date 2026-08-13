# refactor(#1228 / #981 段階2b): dir 由来のリポ解決を 1 つにまとめ、forge を通す

**振る舞いは変わりません。画面に出る変化はゼロです。** 段階4（GitLab 実装）が「1箇所を変えれば
届く」状態にするための構造の仕事で、そのことを先に書いておきます。

## いま

「このディレクトリの remote はどのリポか」を **5 箇所が別々に書いていました**。

```
server/index.ts                  repoFromWebUrl(await resolveGithubUrl(cwd))
server/routes/dir-routes.ts × 2  repoFromWebUrl(await resolveGithubUrl(cwd))
server/git/repo-dirs.ts          repoFromWebUrl(await resolveGithubUrl(dir))
server/config/header-context.ts  repoFromWebUrl(parseGithubWebUrl(remoteUrl))
```

どれも **GitHub 以外は null**。呼び出し側はそれを「リポが無い」と読みます。`work-comment` は実際に
`reason: "no-repo"` を返していましたが、**リポはあります** — GitHub ではないだけです。

`repoFromWebUrl` のコメント自身が「それを広げるのは forge abstraction の仕事」と書いていました。

## やったこと

1. `repoForDir(dir)` / `repoForRemote(url)` が `{ forge, repo }` を返す。
   **`repo` は扱える forge のときだけ文字列**、それ以外は null（＝今までの値そのまま）
2. 5 箇所を置き換え
3. `work-comment` の `reason` が `unsupported-forge` と `no-repo` を区別する
   （**クライアントはこの値を読んでいない**ので、サーバ側の正確さだけ）

## 意図的にやらなかったこと

- **`phaseForRepoBranch` のシグネチャは変えない。** GitLab へ分岐する実装が無いうちに forge を
  受け取らせても、設定する側の無いフィールドと同じで先取りになる。段階4 で変える
- **UI を足さない。** 段階2a は既存の per-repo `error` という置き場所があったが、
  **セル側には無い**。「未対応をどう見せるか」は #981 の未決事項のまま

## テスト

- `repoForRemote`: GitHub は `owner/repo` / **GitLab と自前ホストは「見えているが扱えない」
  （`repo` は null だが答え自体は null ではない）** / 読めない文字列だけが null /
  深い GitHub パスの切り詰めが従来どおり
- `repoForDir`: 実リポの origin を読む / remote 無しは null
