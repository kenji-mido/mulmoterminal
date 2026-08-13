# refactor(#1220 / #981 段階2a): prRepos にホストを書けるようにし、未対応 forge を黙って空にしない

## 相談で決まったこと

1. **`PrPhase` は変えない。** GitLab 固有の状態は `blockedReason` を別に持つ。GitHub 側は常に
   undefined なので既存の消費者は 1 つも変わらない。**本 PR では足さない**（設定する実装が無いうちは
   先取り。段階4 と同時に入れる）
2. **横断一覧では CI を出さない。** GitLab の CI は MR ごとに 1 コール必要（実測）で、
   リポ数 × MR 数になるため
3. **CLI 委譲を続ける**（`glab` に認証ごと預ける）
4. **`prRepos` にホストを書けるようにする** ← 本 PR

## 障害だったこと

読み取り系は全部 `repo: string`（`owner/repo`）を受け取り、**ホストが入っていません**。
段階1 で作った `forgeOf` はここに届きません。さらに設定側で:

```
REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/   ← 2 セグメント固定
```

`gitlab.com/group/project` は**保存する前に落ちていました**。

## やったこと

1. `REPO_RE` を 2 セグメント以上に広げる。`prRepos` と `repoDirs` のキーが共有している
2. `forgeFromRepoEntry` を `forge-host.ts` に足す — **設定エントリ**から forge を引く入口
   （`forgeOf` は remote URL から引く入口。両方 `forgeAt` を共有）
3. `forge-support.ts` — 「その forge で実際に何ができるか」。GitHub 以外は理由付きで拒否
4. 一覧2つが `repoSupport` で分岐

## ホストかどうかの判定

最初のセグメントに **`.` があればホスト**。GitHub のユーザー名・組織名は英数字とハイフンのみで
ドットを含められないので、`owner/repo` と `host/owner/repo` は一意に分かれます。

## 「未対応」の見せ方に UI を足していない理由

`RepoPrs` / `RepoIssues` に**既に per-repo の `error` があります**（`gh` 失敗時に使われる経路）。
そこに載せるだけで画面に出るので、段階1 で保留にした「未対応をどう見せるか」は、
**この面については既に答えがありました**。

## 意図的に変えた既存テスト

- `sanitizeRepos` が `"x/y/z"` を落とす前提だったもの → 受け入れるようになった
- `sanitizeRepoDirs` が `"a/b/c"` キーを落とす前提だったもの → 同上

どちらも本 PR の目的そのものなので、理由をテストにコメントとして残しています。

## やらないこと

- セルの phase（dir 由来）— dir から forge を引けるので識別子の問題が無い。別 issue
- `blockedReason`（段階4 と同時）/ GitLab 実装（段階4）/ 語彙の中立化（段階3）
