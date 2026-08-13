# feat(#1281 / #981 段階4b): GitLab の MR でも PR フェーズ pill を出す

#981 の**最後の実装段階**。

## セルは1ブランチなので、単体エンドポイントを叩ける

段階4a（横断一覧）では「CI は MR ごと1コールなので払えない」として `ci: none` にした。
**ここは事情が違う** — セルは1ブランチしか見ないので、`mr view` を1回足せる。
`head_pipeline.status` はそこにしか無い。

## 相談で決めた形（#981 コメント）

**`PrPhase` は変えず、`blockedReason` を別フィールドで持つ。** GitHub 側は常に null なので
既存の消費者は1つも変わらない。

GitLab の `detailed_merge_status` は GitHub が3つに分ける情報を1つに畳んでおり、
`not_approved` / `discussions_not_resolved` / `merge_request_blocked` は **enum に居場所が無い**。
`ready` にすると「マージできないものを ready と呼ぶ」、`changes-requested` にすると
「誰も変更を要求していないのにそう見える」。**phase は近い値に寄せ、正確な理由は別に置く。**

## 実データで確認したこと

`detailed_merge_status` と `head_pipeline.status` は**独立**。公開プロジェクトの実 MR:

```
!3675  pipeline=success  merge=not_approved              -> changes-requested / waiting on approvals
!3670  pipeline=success  merge=discussions_not_resolved  -> changes-requested / unresolved discussions
!3660  pipeline=failed   merge=not_approved              -> ci-failing / waiting on approvals
```

**`!3660` が要点** — CI 失敗と承認待ちを**両方**表現できている。phase 1つでは落ちる情報。

## 決めたこと

- **知らない status は「ready ではないが、理由も言わない」。** 2つ両方が要る:
  `ready` にすると**マージできないものに緑の pill**が出る（GitLab は `mergeable` 以外を名乗っている）。
  かといって raw の status を理由に出すと、**GitLab 内部の識別子がツールチップに出る**。
  phase だけが「誰かが動く必要がある」と言い、理由は空にする。
  **この PR のレビューで、片方ずつ両方とも間違えた**（最初は ready、次は識別子を出した）
- **draft が最優先**（`derivePrPhase` と同じ順序）。作者自身の「まだ」はプロジェクト側の事情に優先
- **理由は hover tip に出す**（`workTip`）。chip 本体は数字だけ、というルールは変えない
- 詳細取得に失敗したら**一覧の答えに縮退**する（行ごと失うより良い）

## 構造

`phaseForRepoBranch` の complexity が 23 になり lint に止められたので、**GitHub 側も関数に
切り出した**（`githubPhase`）。GitLab 側は元から別関数なので、これで対称になる。

## 検証

- 純関数 78 件（状態の優先順位、未知 status、pipeline の各値、独立性）
- **既存テストは新フィールドの追加分のみ更新** — うち `pr-phase-route.spec.ts` は
  「フィールド名を1つずつ列挙して形の変化に気づかせる」テストで、**意図どおり落ちた**
- **実機**: GitLab の MR が `draft` として出る / 無いブランチは `none` / GitHub は不変 /
  公開 MR 3件で `blockedReason` が正しく出る
