# feat(#1239 / #981 段階4a): 横断一覧が GitLab の MR / issue を読む

**GitHub の挙動は変えない。GitLab を既存の形に合わせる。** これが本段階の制約。

## 実データで確かめた罠（gitlab.com の公開プロジェクトに対して実行）

1. **`iid` を使う。** `id` はインスタンス全体で一意な別物で、UI にも URL にも出ない。
   間違えると「どこにも存在しない番号」の行ができる
2. **`web_url` をそのまま使う。** GitLab は issue を `/-/work_items/` に移行中で、API はもう
   そちらを返す。URL を組み立てると古い方を指す
3. **`-F` の意味がサブコマンドで違う。** `mr list` では出力形式、`issue list` では
   `--output-format`（details/ids/urls）で、形式は `-O`
4. **状態フィルタ。** `issue list` には `--opened` があるので明示。`mr list` には無く、
   help が「Defaults to open merge requests」と明記しているのでそれに従う

## GitHub の語彙のまま写す

`detailed_merge_status` は GitHub が3つに分ける情報を1つに畳んでいる。意味が本当に一致するものだけ
写し、**残りは埋めない**。

| GitLab | → |
| --- | --- |
| `requested_changes` | `CHANGES_REQUESTED` |
| `not_approved` | `REVIEW_REQUIRED` |
| `mergeable` / `discussions_not_resolved` / `merge_request_blocked` / `unchecked` / `conflict` | `null` |
| `ci_must_pass` | `ci: pending` |
| それ以外 | `ci: none` |

**`ci: none` の限界は承知のうえ。** CI を持つプロジェクトでも「チェック無し」の薄いドットになる。
正確に出すには MR ごとに1コール必要（実測）で、横断一覧では払えない。`CiState` を広げれば表現
できるが、**それは GitHub 側の型と UI を変える**ので採らない。

## テスト

写像は純関数にし、**gitlab.com から取得した実データ**を fixture にして固定（手書きしない）。
argv も固定する — フラグを1つ間違えても**コマンドは動いて違うものを返す**ので、型では捕まらない。

## 検証の状況

**glab 経由の実行確認は未実施。** 期限切れの OAuth トークンが公開プロジェクトの読み取りまで
塞いでいるため（トークンが無い状態では読めていた）。API 自体は匿名で 200 を返すので、
設計に使ったデータは実物。再認証後に一覧表示まで確認する。

## やらないこと

- `prPhase`（セルの pill）— 段階4b
- 書き込み系（MR 作成・コメント・issue クローズ）— glab のコマンド体系が未検証
- 語彙の中立化（段階3）、doctor（段階5）
