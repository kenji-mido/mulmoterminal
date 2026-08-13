# refactor(#1214 / #981 段階1): git remote からホスト種別を返す層を足す

## なぜ先にこれなのか

`parseGithubWebUrl` が `string | null` を返し、その null が 6 箇所に伝播している。

```
server/index.ts（2）  server/config/header-context.ts  server/routes/dir-routes.ts（2）
server/git/repo-dirs.ts  server/git/worktree-pr.ts
```

問題は **「GitLab のリポジトリだ」と「そもそも git remote が無い」が同じ null に潰れている**こと。
どの機能もその null を「GitHub じゃないから自分は消える」と読むので、GitLab ユーザーには
**説明ではなく沈黙**が返る。

しかもその面は #981 を書いた時点より広がっている。`gh` を叩くファイルのうち 3 つが #981 の表に
無い（`issue-work.ts` は 3.0.0 で追加、`work-comment.ts`、`branch-query.ts`）。3.0.0 の
`repo-dirs.ts` も同じ経路なので、**新機能が同じ形で黙って無効化される**。やらない間もコストが増える。

## 構造

`remote-ref.ts`（git の URL 形式。ホストに無関心）の上に 1 枚だけ足す。

```
remote-ref.ts   git の URL 形式          → { host, path }
forge-host.ts   どの forge か（今回）     → { host, kind, path, webUrl }
gitRemote.ts    GitHub 視点の答え（既存）  → string | null
```

`parseGithubWebUrl` は `forgeOf` の上の薄いラッパーに書き換える。**6 箇所の呼び出しは変えない。**

## 決めたこと

- **`kind` は URL から分かるものだけ**。`github.com` / `gitlab.com` の 2 つで、それ以外は `unknown`。
  自前ホスティングの GitLab は URL では判別できないので、**宣言する設定は入れない** —
  それを読む GitLab 実装（#981 段階4）が無いうちは使い道が無く、先取りになる
- **`path` は分割しない**。GitHub は `owner/repo` の 2 セグメント、GitLab はグループがネストするので
  「何セグメントで 1 プロジェクトか」は**ホストの規則**。`webUrl` の組み立てだけが kind ごとに違う
- **null は「読める remote が無い」だけに残す**。`unknown` と別物にすることがこのモジュールの要点
- **UI は入れない**。「未対応です」の見せ方は #981 の未決事項（GitHub ユーザーへのノイズとの
  トレードオフ）なので独立して決める

## テスト

- `forgeOf`: URL 形式 7 種すべてで kind が保たれる / gitlab.com / ネストしたグループパス /
  GitHub の深いパスの切り詰め / 自前ホスト・codeberg が `unknown` で **null ではない** /
  ホストの小文字化 / null になる 3 ケース
- **既存の `parseGithubWebUrl` / `remote-ref` の spec 45 件がそのまま通ること**（振る舞い不変の証拠）
- `/api/git-remote` が `forge` を返す・remote 無しでは `forge: null`

## この段階でやらないこと

- forge インターフェイス（#981 段階2）
- 語彙の中立化（#981 段階3）
- GitLab 実装 / `glab`（#981 段階4）— `glab` のコマンド体系はこの環境で未検証
- doctor と設定の追随（#981 段階5）
