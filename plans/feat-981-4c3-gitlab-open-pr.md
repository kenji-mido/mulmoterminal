# feat(#1277 / #981 段階4c-3): GitLab の worktree から ⧉ Open PR

#981 の最後の実装段階。**GitHub の挙動は変えない。**

## この経路だけ構造が違う

他の GitLab 対応は `--repo <owner/repo>` を渡す形だったが、ここは **worktree の cwd から
repo を推測**させている（`--repo` は `OWNER/REPO` しか受け付けないので、リポジトリの PATH を
渡すと必ず失敗する、とコメントに書かれている）。

**glab も同じことができる**ことを実物で確認した — remote だけ設定したディレクトリで
`glab mr list` が通る。なので `--repo` を足す必要はなく、**変えるのは「どの CLI を呼ぶか」だけ**。

## 実物で確認した4操作（テストプロジェクトで実行）

| したいこと | glab | 確認 |
| --- | --- | --- |
| 作る | `mr create --fill -s <br> -b <base> --yes` | MR が実際に作られた |
| 既存を探す | `mr list --source-branch <br> -F json` | `web_url` が取れた |
| 本文を読む | `mr view <url> -F json` の `description` | 取れた |
| 本文を書く | `mr update <url> --description <text>` | 書けて読み戻せた |

**`gh` との差2つ:**

1. **`--fill` は push も行う**（`gh pr create --fill` は行わない）。push していないブランチから
   MR が作られることを確認済み。`pushWorktree` の後なら無害で、push が飛んだ場合はこれが救う
2. **URL をそのまま渡せる**（`mr view` / `mr update` とも）。だから `finalizePrBody` は
   受け取った URL を持ち回る形のままでよい

## 構造

`PrOps`（cli / create / forBranch / viewBody / readBody / readUrl / updateBody）にまとめ、
**cwd の remote から1回だけ選ぶ**。4操作は同じ MR を指すので、混ざると片方を読んで片方に書く。

`readBody` と `readUrl` を ops に持たせたのは、**出力形式が違う**ため — gh は `--jq` で生文字列、
glab は JSON。呼び出し側に三項を置くと lint（`no-nested-conditional`）にも引っかかる。

## `via` の名前を変えた

`"gh" | "compare"` → **`"cli" | "compare"`**。glab がここに来ると「gh で作った」と報告することに
なる。UI は `via === "cli"` で「PR created」と出すだけなので、意味を**結果**に寄せた。

## 検証

- 既存テストは `via` の値以外**無改変で通過**（GitHub 経路が不変であることの証拠）
- 純関数と argv 58 件（`--repo` を渡さないこと、URL 指定、空 description、空リスト）
- **実機**: 管理下の worktree から `createOrOpenPR` を2回
  - 1回目 `{ok: true, url: .../merge_requests/3, via: "cli"}` — MR が作られた
  - 2回目 **同じ URL** — 既存 MR を開く
  - 本文に **`Fixes #1` とフッター `work in glreal`** の両方が入った
