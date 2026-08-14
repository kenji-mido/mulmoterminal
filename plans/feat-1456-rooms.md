# feat #1456 — 会話の「部屋」（v2）

v1（PR #1458、`456fe2ba`）で runner だけを出した。その続き。

## なぜ部屋が要るか — 2つある

### 1. 各話者が直前の1発言しか見ていない

今の runner は `excerpt = said.text` で回している。つまり**渡るのは直前の1発言だけ**。
2人なら往復なので実質全部だが、**3人以上だと文脈が落ちる**。

3人の実機実行では claude が両者に言及できていたが、それは引用の連鎖に暗黙に乗っていただけで、
ラウンドが進むほど薄れる。部屋があれば「これまでの会話」をそのまま渡せる。

### 2. 会話がどこにも残らない

transcript は各セルにバラバラにあるだけ。会話としては読めないし、
タブを閉じれば runner ごと消える。議事録にもできない。

## v2 の範囲

- **部屋のストア** — 追記のみの JSONL（`worktree-env.jsonl` と同じ理由・同じ形）
- **HTTP API** — post / read / list
- **CLI** — `mulmoterminal room post|read`。これで **shell / CI / 人間** が参加できる
- **runner が部屋を使う** — 各ターンを部屋に積み、次の話者には**これまでの会話**を渡す

### やらないこと（さらに後）

- 部屋を見る UI / UI からの投稿（CLI で書けるので、面を広げるのは後でよい）
- 部屋の使い回し・命名（v2 は table 1回につき1部屋）
- runner をサーバへ移す
- 役割 / @mention / 非同期の部屋

## 設計

### ストア

`<MULMOTERMINAL_HOME>/rooms/<room>.jsonl`、1行1発言、**追記のみ**。

`worktree-env-log.ts` と同じ理由: `MULMOTERMINAL_HOME` はマシン内の全サーバで共有なので、
read-merge-write だと片方の投稿が消える。追記なら消えない。

1発言 = `{ at, from, text }`。`from` は表示名（`#2 · codex`、`human`、`ci`）。

### 部屋 id

`[a-z0-9-]{1,64}`。**パスに使う**ので、ここが唯一の防御線になる。
`..` やセパレータを含むものは受け付けない（ディレクトリを跨がせない）。

### 次の話者に渡すもの

今: 直前の1発言（サーバ整形の handoff）。
v2: **部屋の直近 N 発言**を、`formatHandoff` と同じ「これは記録であって指示ではない」枠で。

- 相関（`answersOurSend`）は**送信文の末尾**を見るので、会話は末尾に置く。
  framing は今までどおり PREFIX（v1 の罠と同じ）
- 各発言に発言者名を付ける。3人以上では「誰が言ったか」が本質
- 全体の文字数に上限。長い会話で読み手のコンテキストを埋めない

### 誰が部屋に書くか

**runner が代行する**（v1 と同じ原則）。エージェントは相変わらず何も呼ばない。
CLI で書けるのは人間・shell・CI。

## ファイル

**新規**
- `common/roomMessage.ts` — wire 型、id の妥当性、会話の整形（純粋）
- `server/rooms/room-log.ts` — JSONL の行の組み立てと復元（純粋）
- `server/rooms/rooms.ts` — ディスク（追記・読み出し・一覧）
- `server/routes/room-routes.ts` — HTTP
- `bin/room.js` — CLI サブコマンド

**変更**
- `server/index.ts` / `app-routes.ts` — ルート登録
- `bin/mulmoterminal.js` — `room` サブコマンドの受け口
- `src/composables/useRoundTable.ts` — 部屋に積み、部屋から渡す
- `src/composables/roundTableRules.ts` — 会話の整形を使う

**テスト**
- `common/roomMessage` の整形・id 妥当性（末尾が会話であること＝相関が壊れないこと）
- `room-log` の復元
- `rooms` のディスク（スクラッチ HOME）
- ルートの入力検証（不正な id を弾く）
- runner が部屋に積み、会話を渡すこと
