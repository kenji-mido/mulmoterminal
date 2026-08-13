# feat(#1270 / #981 段階4c-2): GitLab の issue に作業コメントを書く

`issueWorkComments`（既定 off）は GitLab のリポでは何も起きなかった。3操作を forge 対応にする。

## 実物で確認したこと（glab 1.111.0、テストプロジェクトで往復）

**コマンド名が違う。** `gh issue comment` に対して **`glab issue note`**（`comment` ではない）、
メッセージは `-m`。

**一番の差: 既存コメントが `issue view` の JSON に入らない。**

- `glab issue view <n> -F json` … `comments` キー**無し**
- `--comments` を足しても JSON には出ない（人間向け表示のフラグ）
- `glab api projects/:id/issues/:iid/notes` … ここで取れる

GitHub が1回で取る「コメント一覧 ＋ state」が、GitLab では **2コール**になる。

**`system` フラグ。** notes には GitLab 自身が書いたもの（closed、ラベル変更）が混ざり
`system: true` で区別される。**重複チェックがこれを拾うと、一度閉じた issue が
「もうコメント済み」と誤判定される。**

**state の綴りも違う。** GitHub は `OPEN`、GitLab は **`opened`**（小文字）。
読み違えると全 issue が closed に見え、マージ時のクローズが一度も動かない。

## 構造

3箇所を個別に分岐させず、**`IssueOps`（view / comment / close）にまとめて1箇所で選ぶ**。
3つは常に同じホストに属するので、混ざると「片方の issue を読んでもう片方に書く」ことになる。

`runGh` は spec が注入するので GitHub 経路はそのまま受け取る。GitLab 側にはまだその継ぎ目が
無いので、純粋な部分（notes の解釈、state の判定、argv）を直接テストする。

## 検証

- 既存テストが**無改変で通過**（GitHub 経路が不変であることの証拠）
- 純関数 43 件（system note の除外、state の綴り、argv、project の percent エンコード）
- **実機**: テストプロジェクトの issue に対して
  - 1回目 `{posted: true}` / 2回目 `{posted: false, reason: "already"}` — **重複チェックが効く**
  - `closeIssue: true` で `{posted: true, closed: true}`、GitLab 側の state が `closed` になる

## やらないこと

- ⧉ Open PR（`worktree-pr.ts`）— `Runner` 型の変更を伴う。4c-3
- PR フェーズ pill（段階4b）、語彙の中立化（段階3）、doctor（段階5）
