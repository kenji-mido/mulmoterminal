# fix: セッションメモを cockpit roster に出す (#1105)

#1084 で入れたセッションメモが、グリッドを拡大したときの cockpit roster に出ない。

## 何が起きているか

サーバはもうメモを返している。**クライアントのロスターがマージで捨てている。**

`GET /api/session/:id` → `sessionDetailView()` は `memo` を含む（#1084 で入った）。ロスターは
`seedMeta()` でそれを取り、`mergeSessionMeta()` に通して `sessionMeta` に入れる。その
`SessionMetaView` に `memo` のフィールドが無いので、取得した値はここで消える。

出ない場所は cockpit roster **だけ**。セルヘッダ（`cellHeaderText`）と縦の Sidebar
（`/api/sessions` → `sessionListTitle`）は #1084 の時点で通っている。

## 決めたこと

| 論点               | 決定                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| 行の位置           | `summary` の**上**。下の3行はすべてエージェントが言ったこと、メモはユーザーが言ったこと |
| 既存行との関係     | 置き換えではなく**追加**。セルヘッダは1行しかないので置き換えたが、ロスター行は複数行ある |
| マージ規約         | `aiTitle` と同じ（absent = 据え置き、`null` = 消えた）。`lastPrompt` の `??` ではない |
| 行数クランプ       | **付けない**。`cockpitLines` にノブを増やさない（理由は下）                  |
| ラベル             | `memo`。既存の `summary` / `prompt` / `reply` と同じ体裁                     |

### なぜ `??` ではなく `!== undefined` か

`lastPrompt` / `lastResponse` は**トランスクリプト由来**で、読みが一時的に外すことがある。だから
`??` にして「null は据え置き」にしてある。メモは違う — サーバのメモマップにしか無く、取得が
成功した時点でそれが答えで、`null` は「いま無い」（= ユーザーが消した）という**値**。`??` にすると
消したメモが次のポーリング（4秒）で画面に戻ってくる。`aiTitle` が既に同じ理由で
`!== undefined` になっている（#1085）。

### なぜクランプを付けないか

`cockpitLines` の3つのノブは、**長さに上限が無いエージェントのテキスト**のためにある。メモは
`normalizeMemo()` が改行を空白に潰して 200 コードポイントで切るので、構造的に有界。ユーザー自身が
書いた1行を途中で切る理由が無く、ノブを4つ目に増やすのは #1105 が頼まれた仕事ではない。

## 触るところ

- `src/components/rosterPhase.ts` — `SessionMetaView.memo`、`EMPTY_SESSION_META`、
  `mergeSessionMeta()` に `aiTitle` と同じ規約で追加
- `src/components/GridView.vue` — ローカルの `SessionMeta` 型と `listRows` に `memo`
- `src/components/TerminalGrid.vue` — `CockpitRow.memo` と、`summary` 行の上のマークアップ

## テスト

- `mergeSessionMeta` — memo の absent = 据え置き / `null` = クリア / 新しい値で更新
- `EMPTY_SESSION_META` — `memo: null` を持つ
- `TerminalGrid` — memo がある行は memo 行を出す / 無い行は出さない / memo 行が summary より前に来る

## やらないこと

- **`getTerminalScreen`（スマホの1セッション画面）へのメモ配線。** 調査で判明した非対称
  （一覧の `title` には出るが、開いた画面のヘッダは AI サマリに戻る）は本 issue の対象外。
  mulmoserver 側の対応が要るので別 issue。
- **ロスターの即時更新。** ロスター行はポーリング（4秒）でしか更新されない。これは
  `summary` / `prompt` / `reply` と同じで、`sessionMeta` の唯一の書き手を
  `GET /api/session/:id` に保つという既存の不変条件（GridView.vue のコメント）に従う。
  メモを編集した直後はセルヘッダが先に変わり、ロスター行が最大4秒遅れる。
