# feat(github): work comment を「編集され続ける1件」にする (#1369)

## いま入っているもの

`issueWorkComments`（既定 off、グローバル設定）は #979 Phase 2 で入っており、issue に
**着手**と**マージ**の2件をコメントする。dir は `workCommentDirLabel()` が basename に
落としているので、パスの上流は公開 issue に出ない。冪等は二層 — プロセス memo と、
コメント本文に埋めた不可視マーカーの読み戻し。

つまり #1369 のうち「設定で on」「dir は最後のフォルダー名だけ」は**すでに満たしている**。
残っているのは**着手とマージの間**、そして issue が節目ごとに流れることへの対処。

## 決めたこと

| 論点 | 決定 |
| --- | --- |
| 書き方 | **1コメント編集型**。着手時に1件だけ投稿（ここで通知が飛ぶ）、以降は同じコメントを編集 |
| 節目 | 着手 / **PR を開いた** / マージ。各行に**時刻**を持たせる |
| CI | **書かない**。PR を見れば分かる情報で、往復するのでノイズになる |
| 粒度 | グローバル設定 `issueWorkComments` のまま（プロジェクト単位の上書きは作らない） |
| 署名 | MulmoTerminal が書いたと**本文に見える形で**残す |

## コメントの形

```markdown
Working on this in `1234-fix-login`.

- started — 2026-08-04 14:20 UTC
- PR #1240 — 2026-08-04 15:05 UTC

<sub>posted by [MulmoTerminal](https://github.com/receptron/mulmoterminal)</sub>

<!-- mulmoterminal:work:start dir=1234-fix-login -->
```

マージ後は同じコメントの見出しと行が書き換わる。

```markdown
Merged in #1240. Work done in `1234-fix-login`.

- started — 2026-08-04 14:20 UTC
- PR #1240 — 2026-08-04 15:05 UTC
- merged in #1240 — 2026-08-04 16:40 UTC
```

- **見出しの文言は現行のまま**（`Working on this in …` / `Merged in #N. Work done in …`）。
  既に投稿されたコメントと読み味を変えない。
- **マーカーは現行のまま** `<!-- mulmoterminal:work:start dir=… -->`。これを
  「そのクローンの1件」を指すアンカーとして使い回すので、**移行処理が要らない** —
  旧ビルドが書いたコメントはそのまま編集対象になる。
- 旧ビルドの `:merged` マーカー付きコメントがある issue では、merged は**記録済み**として
  扱う（アップグレード途中の issue で同じことを2回言わない）。

## 時刻

- サーバの時計で打つ（クライアントの時計は信用しない）。書式は `YYYY-MM-DD HH:MM UTC` 固定。
- 旧ビルドが書いたコメントには行が無いので、**そのコメントの `createdAt` を started の時刻**
  として使う。状態をどこにも永続化しないで済む。

## 実装

### `common/workComment.ts`（純粋・両側共有）

- `WorkCommentKind = "start" | "pr" | "merged"` と `isWorkCommentKind`
- `WorkEvent { kind; at; pr? }`
- `renderWorkComment(dir, events)` / `parseWorkEvents(body)` — **往復が恒等**であることを spec で固定
- `withWorkEvent(events, event)` — すでに記録済みなら `null`
- `formatWorkTime(date)`
- 既存の `workCommentMarker` / `workCommentDirLabel` / `alreadyCommented` は据え置き

行のパースは**厳格**にする（`\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC` に一致しない行は捨てる）。
人が本文を編集した場合に、任意のテキストをこちらが書き戻さないため。

### `server/git/work-comment.ts`

- `IssueOps` に `edit(ref, body)` を追加。`view()` はコメントを `{ body, ref, createdAt }` で返す。
- GitHub: `gh api --hostname <host> --method PATCH repos/<owner>/<repo>/issues/comments/<id> -f body=…`
  （id はコメント URL の `#issuecomment-<id>` から取る。`--json comments` が返す `id` は
  GraphQL node id で REST には使えない）
- GitLab: `glab api --hostname <host> --method PUT projects/<enc>/issues/<iid>/notes/<id> --raw-field body=…`
  （notes の REST 応答が持つ数値 id。`glab-items.ts` の `glabNoteBodies` を id 付きに広げる）
- 流れ: memo → issue を読む → アンカーを探す → 無ければ投稿 / 有れば必要な行が無いときだけ編集
- マージ時の issue クローズは現行どおり best-effort
- **ロックの単位を「節目」から「コメント」に変える。** 記録は read-modify-write（過去の節目は
  コメント本文にしか無い）なので、2つの節目が同時に走ると後勝ちで片方の行が消える。さらに
  コメントがまだ無い状態では**2件投稿されてしまう**。`server/infra/serialize-per-key.ts` に
  キー単位の直列化を切り出し、`issue-work.ts` の同型の実装（1 issue 1 worktree）と共有する。

### `server/routes/dir-routes.ts`

`kind` の検証を `isWorkCommentKind` に寄せる。`kind === "pr"` は PR 番号必須（無ければ 400）。

### `src/composables/useWorkItem.ts`

`workCommentToPost` に PR の規則を足す。**このセッションが PR の出現を見たときだけ**返す
（`before.issue === now.issue && before.pr === null && now.pr !== null`）。リロード直後に
既存 PR を見つけても書かない — 時刻が「気づいた時刻」になり、事実と違うため。merged が
すでに同じ規則で書かれているので、規則を1本に揃える。

## テスト

- `common` の純粋関数: render/parse 往復、旧本文（行なし）の扱い、壊れた行を捨てること
- `ensureWorkComment`: アンカーを見つけて編集する / 記録済みなら何もしない / 編集失敗を memo しない /
  旧 `:merged` コメントを記録済みとして扱う / 同時 2 コールで 1 回だけ書く（既存）
- `workCommentToPost`: PR を見たときだけ `pr`、リロードでは返さない

## 動作確認（外部の ground truth）— 実施済み

1. `gh api --method PATCH …/issues/comments/999999999999` と
   `glab api --method PUT projects/…/notes/1` を実行し、**フラグが解釈され**て 404（対象が無い）
   が返ることを確認した。何も書き込んでいない。
2. `ensureWorkComment` を実物の `gh` で issue #1369 に対して走らせ、GitHub 側から読み戻した:
   - `start` → コメントが1件投稿される
   - `pr` → **同じコメントが編集され**、`- PR #1370 — …` の行が増える（2件目は増えない）
   - もう一度 `pr` → `{ posted: false, reason: "already" }`
   確認後、そのコメントは `gh api --method DELETE` で削除済み。
3. GitLab の PUT は 1. の形確認どまり（手元に検証用プロジェクトを作らないため）。失敗しても
   コメントが更新されないだけで、作業は止まらない。

## ドキュメント

- `docs/guide/{en,ja}/config.md` の `issue-work-comments` 節を書き換え（最大2件 → 常に1件、
  PR 行、署名、時刻）
- リリース時に `docs/ChangeLog.md` と `docs/guide/{en,ja}/v<version>.md`
