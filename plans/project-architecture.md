# MulmoTerminal: Project アーキテクチャと Cowork 的な働き方

作成 2026-08-08（`feat-cowork-proposal.md` と `feat-workers-proposal.md` を統合し、この 1 本にまとめた）
発端: 「MulmoTerminal で CoWork が使えたら」というコメント / ChatGPT と作った Project アーキテクチャ草案

---

## 0. 決まったこと（先に一覧）

| # | 決定 | 章 |
|---|---|---|
| D1 | 目指すのは **B = Cowork のような「働き方」**。Cowork 本体の取り込み（API なし）は不可、プラグイン資産の話は本題ではない | 1 |
| D2 | **Project = `.mulmoterminal.json` を持つ既存ディレクトリの言い換え。** 新しい抽象レイヤ・インデックス・uuid・ストレージ抽象は作らない | 3 |
| D3 | **原本（持ち込み資料）は書き換えない。** source は読み取り専用、生成物は別に書く。好みではなくハードルール | 4 |
| D4 | **4 つの部分系（collections / accounting / wiki / resources）は 1 つの問題。** `resolveProjectRoot(sessionCwd)` を 1 つ決めて共有する | 5 |
| D5 | **resources の索引を最初から Collection にしない。** 上流待ちに巻き込まれる。後から昇格させる | 5 |
| D6 | 着手は **上流 A（collections の root 通し）を並行で開始 + 手元は resources から** | 9 |
| D7 | **共有ワークスペースも 1 つの Project として扱う**（特別扱いしない）。ただし一斉移行はせず、accounting / wiki は当面ワークスペース束縛のままで、**他 Project では非表示にする** | 5-3b |

未決は 11 章に集約。

---

## 1. 何を作るのか — Cowork とは何で、何を採るか

### 1-1. Cowork の実体

Anthropic の製品で、**Claude Code のアーキテクチャをコード以外の仕事に向け直したもの**。
チャットは質問に答える、Cowork は**行動する** — ファイルを読み書きし、スケジュールで走り、
**終わった仕事を返す**。Claude Code との差は対象と面だけで、機構はほぼ同じ。

| 項目 | 実体 |
|---|---|
| 実行場所 | Anthropic のクラウドの隔離環境。ローカルに触るときだけ Desktop アプリ経由 |
| 仕事の単位 | **フォルダとファイル**（リポジトリではない） |
| 自律性 | 計画を立て、サブタスクに割る。並列実行あり |
| 拡張 | プラグイン（スキル + コネクタ + サブエージェント）。スキルは `SKILL.md`、**Claude Code と可搬** |
| 指示の持続 | Global Instructions + フォルダごとの指示 |
| 定期実行 | スケジュールタスク |
| 権限 | コネクタごとに 常に許可 / 承認が必要 / ブロック |
| 面 | web・デスクトップ・モバイル。同じセッションを別の面から引き継げる |

**技術的に新しいものはほぼ無い。新しいのは枠組みと導線。**

### 1-2. 3 つの解釈と採用（D1）

| 解釈 | 実現性 |
|---|---|
| A. Cowork のプラグイン資産を使う | ほぼ既にできる（Claude Code のプラグイン機構がそのまま効く）。本題ではない |
| **B. Cowork のような働き方をする** | **採用。** 土台の大半は既にある |
| C. Cowork のセッションを MT から覗く | **不可**（公開 API なし）。将来 API が出たら 8 章の Worker ロスターに相乗り |

### 1-3. B の正体を 1 行で

> **Cowork のような働き方とは、「ターミナルが UI であることをやめる」こと。**

依頼を平文で書く → 計画が出る → フォルダの中で作業する → **成果物が返ってくる** → 必要なら定期化する。
端末のログは見たい人だけが見る、実装の詳細になる。

**MulmoTerminal はこれを走らせる能力を既に全部持っている。**
足りないのは走らせる力ではなく、**ターミナルが主役でない面**と、**終わった仕事が着地する場所**。

---

## 2. 棚卸し — 既にあるもの

草案の要素をコードと突き合わせた結果。**7 割は新規開発ではなく「命名と提示」の話だった。**

| 要素 | 実体 | 状態 |
|---|---|---|
| Project の設定 | `.mulmoterminal.json` — `name` / `icon` / `colors` / `theme` / `orderPriority` / `skills` / `provider` / `model` / `appendSystemPrompt` / `buttons` / `chips` / `addDirs` / `worktreeEnv` / `sound` | **ある。ほぼ Project マニフェスト** |
| Project の一覧 | `cwdPresets`（`common/repoDirs.ts`）、グリッド、ランチャーチップ | **ある** |
| Multimodal 出力 | GUI MCP（`presentDocument` / `presentChart` / `presentForm` / `presentHtml` / MulmoScript）を `GuiPanel.vue` が描画。履歴は `/api/agent/toolResults/:id` から再生 | **ある。Cowork より強い** |
| PDF 書き出し | `presentDocument` の Marp モード | **ある** |
| Project ごとの MCP | 各フォルダの `.mcp.json` + `toolGroupServerId()` | **ある**（muse は例外、7 章） |
| Skills | `server/skills/` を `~/.claude/skills` と Codex skills root へミラー、`BUNDLED_SKILL_NAMES` が出荷対象 | **ある**（マシン全体。Project 単位ではない） |
| テンプレ = 知識 | 設定を書くスキル群（`-dirs` / `-theme` / `-header` / `-keys` / `-model` / `-notify`）+ ルータ `mulmoterminal-config` | **ある。草案の「テンプレはコードでなく知識」は既にこの形** |
| 定期実行 | `server/backends/scheduler.ts`（cron → チャット spawn、`@mulmoclaude/core/scheduler` 共有） | **エンジンはある。UI が無い** |
| 隠しセッション | `spawnBackgroundChat(hidden: true)`、unplaced セッション、完了フック、`failed-workers.json` | **ある** |
| 成果物の保存 | `artifacts/documents/` | **溜まるが、見る場所が無い** |
| エージェント差し替え | Agent Picker（claude / codex / antigravity / grok / muse / shell / カスタム） | **ある**（費用は 7 章） |
| 承認モード | `--permission-mode` は spawn 時固定 | **ユーザーからは選べない** |

**足りないのは 4 つだけ**: 端末が主役でない面、成果物の着地点、Project 単位のデータ、権限の選択。

---

## 3. Project = 既存ディレクトリの言い換え（D2）

**新しい抽象レイヤは作らない。** Project とは `.mulmoterminal.json` を持つディレクトリのこと。
これは発明ではなく**現状の追認** — `cwd` はセッション・PTY・コスト・会話・バッジ・MCP 解決の
全部でキーとして使われ、`cwdPresets` は絶対パスを保存している。

### 3-1. 作らないもの

- **`projects.json` のようなインデックス**（一覧は `cwdPresets` + `.mulmoterminal.json` を持つディレクトリ。既にある）
- **Project の uuid**（同一性はパス。id とパスの二重管理が発生しない）
- **ストレージ抽象**（下記 3-3）
- **既存リポジトリの移行**（何もしなくても全部 Project）

### 3-2. すること

- **「Project を作る」= `mkdir` + `.mulmoterminal.json` を書く**（+ 任意で `git init`、
  + テンプレ知識から AI が初期構成）。新しい永続層はゼロ
- **表示名はパスと切り離したまま。** `.mulmoterminal.json` の `name` が既にそれ。
  ディレクトリを移動すると `cwdPresets`・セッション・定期タスク・コストがパス単位で静かに外れるので、
  **リネーム UI はディレクトリを動かさない**（`name` を書く）
- **git でないディレクトリが一級市民。** branch / diff / PR の部品はエラーではなく非表示で劣化する
- **語の衝突の整理。** ユーザー向けの `Project` と、内部語彙の「project cell」
  （ワークスペースセルでも muse セルでもない、ユーザーの `.mcp.json` を読むセル）は別物

### 3-3. 通らない前提: バッキングは差し替えられない

草案の「Project はフォルダ / Git / クラウド / DB に backed されうる」は通らない。
エージェントは全員 **POSIX ディレクトリの中で動くプロセス**で、tmux・PTY・worktree・
`.mcp.json` 探索・skills ミラー・git chips が全部実在パスに載っている。
「クラウドが backing」は実際には**同期レイヤ**を書くことで、そのレイヤは
**エージェントが最初にファイルを書いた瞬間に漏れる**。

**抽象化するのは保存先ではなく提示。** ユーザーがパスを見ないことと、パスが存在しないことは別。

---

## 4. 資料フォルダは開発フォルダと何が違うか

> 仕組みは開発フォルダと同じ。置くのがソースコードではなく資料（PDF / Excel / Word …）で、
> 生成物もドキュメントが主になる。

仕組みが同じ、は D2 を補強する。ただし**中身の型が違う帰結は大きい —
エージェントの基本道具が 3 つ壊れる。** ここが資料 Project の実作業のほぼ全部。

### 4-1. grep が効かない（一番効く問題）

ソースフォルダでは `grep` が第一の航法で、エージェントはこれで自分の位置を決めている。
PDF / xlsx / docx はバイナリなので **0 件**。**フォルダが見えていない状態で用事を頼む**ことになる。

**対策: 抽出テキストのサイドカー。** 原本の隣に本文を落とせば `grep` も `Read` もそのまま効く。
**新しい検索機構を作るのではなく、既存の道具が復活するだけ**なのが良い。

### 4-2. Read が半分しか効かない

| 形式 | 素で読めるか |
|---|---|
| PDF（ページ指定、上限あり） / 画像 / Markdown / CSV | **読める** |
| **xlsx / docx / pptx** | **読めない。変換が要る** |

**このマシンでの実測（2026-08-08）:** `pdftotext` **あり**（poppler）/
`pandoc` **無し** / `libreoffice`・`soffice` **無し** / python `openpyxl`・`python-docx` **無し**。
**repo 内に変換コードは 1 行も無い**（`pdftotext|pandoc|xlsx|docx` の grep が 0 件）。

**Office 形式は今まったく扱えない。** 埋め方は退屈で確実 — 変換を同梱したスキル 1 本 + 依存。

### 4-3. diff が意味を持たない

バイナリは差分が出ない。git 自動コミットの価値は**「昨日の版に戻せる」に限定される**
（文書仕事では十分大きい）。**生成物の markdown 側は普通に diff が効く**ので、
履歴として価値があるのは生成物のほう。

### 4-4. 出力の型も違う

エージェントが書くのは markdown、人が送りたいのは PDF / docx / xlsx。
**Marp 経由の PDF 書き出しは `presentDocument` に既にある**。docx / xlsx は 4-2 と同じ変換が要る。

### 4-5. 原本は取り返しがつかない（D3）

資料フォルダには「メールで来た唯一の版」が置かれる。再生成できず、git にも入っていないかもしれない。

> **原本を直接書き換えない。** source は読み取り専用、生成物は output に書く。

承認モードより手前の、既定の約束。

### 4-6. フォルダが重い

数百 MB は普通。**全部を自動コミットすると破綻する。**
コミットは生成物 + マニフェストに限り、原本は `.gitignore` か LFS か — **未決**。

---

## 5. collections / accounts / wikis / resources は 1 つの問題（D4）

Project ごとに欲しいものは 4 つに見えるが、**コード上は同じ 1 つの問題**。
**共有の部分系はすべて、ブート時にプロセス全体で 1 つの workspace root に束縛されている。**

| 部分系 | 束縛のしかた | 状態 |
|---|---|---|
| **collections** | `configureCollectionHost({ workspaceRoot })` — **別 host への再束縛は throw**（意図的な不変条件） | ワークスペース単位 |
| **accounting** | `configureAccountingServer({ workspaceRoot })`。`<workspace>/data/accounting` | ワークスペース単位 |
| **wiki** | `mountWikiRoutes(app, { workspace })`。`<workspace>/data/wiki/` を**読み取り専用**で見るだけ（書きは MulmoClaude 側） | ワークスペース単位・読み取り専用 |
| **resources**（持ち込み資料） | — | **存在しない** |

つまり「4 つの仕組みを作る」のではなく、
**「ブート時の root 束縛を、リクエスト単位の root 解決に置き換える」を 4 箇所でやる**のが正体。

### 5-1. 継ぎ目は既に名指しされている

`server/backends/accounting.ts` のコメントに、この結論が先回りして書いてある:

> The single-root DI (one workspaceRoot for the whole process) is exactly what the FOCUSED
> freelance product wants — one pinned business workspace. **A generic accounting-in-MulmoTerminal
> would later swap this for a per-request cwd resolver (the dispatch request already carries the
> session cwd).**

**「dispatch のリクエストは既に session の cwd を運んでいる」** — ここが継ぎ目。
D2（Project = ディレクトリ）と噛み合う: **cwd がそのまま Project の同一性**。

**4 つ別々に解かず、`resolveProjectRoot(sessionCwd)` を 1 つ決めて 4 つの host アダプタが全部使う。**
レイアウトも 1 つに揃える。**ただし「揃える」は「既にあるものを動かす」ではない。**

- **collections は既存のレイアウトのまま動かさない** — `<project>/.claude/skills/<slug>/` と
  `<project>/data/collections/<slug>/items/`。エンジンが解決するのはこのパスで、
  self-contained（git clone parity、[collections plan](./feat-collections-project-root.md) §11）が
  成り立っているのもこの形に対して。しかも CLAUDE.md は MulmoClaude と**同じディスク配置**を
  要求している。動かせば両方壊れる
- **統一した置き場所（例 `<project>/.mulmoterminal/data/…`）は、自前のレイアウトをまだ持たない
  部分系 ＝ resources 以降のためのもの**

**揃えるべきは「どの root か」を決める経路（`resolveProjectRoot`）であって、ディレクトリ名ではない。**

なお collections は**レイアウト関数が既に root 引数化されている**
（`projectSkillsDir(root)` / `feedsRoot(root)` / `skillsStagingDir(root)`、`importRegistry` は root を明示的に受け取る）。
グローバルなのは束縛だけで、読み side が `getWorkspaceRoot()` を暗黙に読んでいるのが残り。

### 5-2. 4 つは難易度が同じではない

- **collections** — 上流（`@mulmoclaude/core`）の変更。**リードタイムが一番長い**（5-3）
- **accounting** — 上流に同じ形の変更 + **製品判断**。今の「1 つのピン留めされた事業ワークスペース」は
  意図した設計で、Project ごとの帳簿は自然（1 Project = 1 事業体）だが**フォーカスを外す判断**でもある
- **wiki** — 一番遠い。MT では読み取り専用で書きは MulmoClaude 側。root を渡すだけでは済まず、
  **MT に書き込み層を生やす**話になる
- **resources** — **唯一の更地。上流依存ゼロ。資料 Project が一番必要としているもの**

### 5-3. collections は MulmoClaude 先行の変更になる

CLAUDE.md の参照ホスト規約がそのまま効く。`@mulmoclaude/core` は MulmoClaude と
**同じワークスペースを同じパッケージで**駆動していて、`/api/*` の命名権も向こうにある。

性質に注意: **MulmoClaude は単一ワークスペースで設計上足りている。**
多 root を必要としているのは MulmoTerminal だけなので、上流 API は
**「root 省略時は従来どおり束縛された root」**の形で足し、向こうを変えずに済ませる。

**波及**: 今の slug はワークスペース内で一意。Project 単位になると Project 内でしか一意でないので、
リクエストがどの Project かを名指す必要がある。**ただしパスは変えない** —
`/api/collections/:slug` の命名権は MulmoClaude の `apiRoutes.ts` にあり、そこに Project の概念は無い。
セグメントを挿す（`/api/collections/:project/:slug`）と全ルートが命名権から分岐するので、
**省略可能な帯域外パラメータ（`?project=<opaque id>`）で運ぶ**。省略時は共有ワークスペースで、
現在と完全に同じ挙動。詳細は [collections plan](./feat-collections-project-root.md) §5。

### 5-3b. 共有ワークスペースも 1 つの Project（D7）

`~/mulmoclaude` は `.claude/skills` を持つディレクトリで、他の Project と**同じ種類のもの**。
既定の root（`?project=` 省略時）ではあるが、それは後方互換のためであって特別だからではない。
**判別フラグを持たせない**のが肝心で、`kind: "workspace" | "project"` のような区別こそ、
特別扱いが再発する場所になる。この決定は**作業を増やすのではなく減らす**（分岐が 1 本消える）。

**ただし一斉移行はしない。** accounting / wiki / feeds / scheduler は当面ブート時束縛のまま。
つまり移行期の `~/mulmoclaude` は「それらの部分系もたまたま指している Project」になる。
その非対称を正直に見せる UI 規則:

> **まだワークスペース束縛の部分系は、選択中の Project がワークスペースのときだけ出す。**
> 空で出さない。他 Project のデータに対しては絶対に出さない。

Project「Q3-report」で空の Accounting パネルは「まだ帳簿が無い」に読めるが、実際は
「この部分系はまだ Project に追随しない」。**出さないことが、正しく伝える。**

accounting（次いで wiki）の移行は、同じ resolver を別の host アダプタに当てるだけ。
**意図的にこの変更に束ねない。**

### 5-4. resources は他の 3 つと性質が違う

collections / accounts / wiki は**アプリが所有する構造化ストア**。
resources は**ユーザーが外から持ち込んだファイル**で、アプリは所有していない。

- **原本を書き換えない**（D3）。read-only 領域
- **由来を持つ** — いつ、どこから来たか。「この数字はどの版の Excel か」は資料仕事で必ず問題になる
- **抽出サイドカーを持つ**（4-1）。`grep` と `Read` が復活する
- **重い**（4-6）

### 5-5. resources の索引を Collection にしない（当面、D5）

「resources の索引は document-index Collection にすればいい」は自然だが、**当面やらない。**
collections は上流待ちなので、更地の resources が**一番長いリードタイムに巻き込まれる**。

**まず素のファイル + サイドカー + 由来 JSON で作り、Project 単位の Collections が着地したら昇格させる。**
昇格は後からできるが、逆（最初から依存させる）は戻せない。

---

## 6. Job — 仕事の単位（動詞）

Project は容器（名詞）。だが人は容器を開きに来るのではなく、**用事を片付けに来る**。

```text
Project（容器・名詞）
  └ Job（1 件の用事・動詞）
       ├ 依頼（平文）
       ├ 進捗（ターミナルは既定で見せない）
       ├ 成果物 → Inbox
       └ 定期化（scheduler）
```

**Project だけ作ると「名前のついたフォルダ」で終わる。Job だけ作ると容器が無い。両方要る。**

### 6-1. 中心の設計判断: Jobs は新しい AGENT ではなく新しい VIEW

プログラムから始まるチャットは全部 `useChatLauncher` → `placeSpawnedChat` を通って
**グリッドのセルになる**。つまり足りないのはサーバの能力ではなく、
**ターミナルを出さないクライアント面**。

| | 新しい agent 種別 | **新しい view（採用）** |
|---|---|---|
| spawn 経路 | 増える。`carriesFullGuiMcp()` の聞き忘れ・worktree・agent 判定が再発 | **増えない** |
| グリッドへの影響 | セルの分岐が増える | ゼロ |
| 実装量 | サーバ + UI | ほぼ UI |
| 他エージェントに広げるとき | 種別が掛け算で増える | view は agent に無関心 |

### 6-2. Jobs ビューの形

```text
┌─ Jobs ─────────────────────────────────────────────┐
│ Project: 決算2026                     [変更]        │
│ ┌─ 依頼 ───────────────────────┐ ┌─ 成果物 ──────┐ │
│ │ 先月の領収書を突き合わせて   │ │ [レポート.md] │ │
│ │ 抜けを一覧にして            │ │ [表 (chart)]  │ │
│ │                    [実行]   │ │               │ │
│ ├─ 進捗 ──────────────────────┤ │  ← GuiPanel   │ │
│ │ 計画を立てています…          │ │    そのまま   │ │
│ │ 12 件のファイルを読みました  │ │               │ │
│ │            [端末を見る ▾]   │ │               │ │
│ └─────────────────────────────┘ └───────────────┘ │
└────────────────────────────────────────────────────┘
```

右ペインは **`GuiPanel.vue` をそのまま置く**（欲しい面の右半分は完成している）。
左は既存 transcript を「ツール呼び出しの羅列」ではなく**進捗の行**として出す
（`session-summary-prompt.ts` / `activity-state.ts` の情報で足りる）。
「端末を見る」で従来のセルに落ちる。新規は左ペインと、
`placeSpawnedChat` を通さない分岐（＝グリッドにセルを作らない）だけ。

### 6-3. Inbox — 終わった仕事の着地点

`artifacts/documents/` の一覧（新しい順 / Project 色つき / どの Job が作ったか）。
クリックで `presentDocument`（既存の `path` 引数でそのまま開く）。
**Cowork の価値の本体は「終わった仕事が手元に届く」ことなので、
ここが無いと Jobs は fire-and-forget になる。**

### 6-4. フォルダ・プロファイル

`.mulmoterminal.json` に数フィールド足すだけで「フォルダごとの指示」になる。

- `role` — このフォルダでの役目（「経理」「原稿」「調査」）。依頼の前置きとして seed に入る
- `instructions` — フォルダ固有の恒久指示（Cowork の folder instructions 相当）
- `defaultSkills` — 最初から効かせるスキル

置き場所は `common/`。設定を足したら**持ち主のスキル `mulmoterminal-dirs` を更新する**
（ルータ `mulmoterminal-config` は目次のまま）。

### 6-5. 承認モードと定期実行 UI

- **承認モード**: 実ファイルを触るので、フォルダ単位で選べるようにする。
  最小形は `.mulmoterminal.json` の `permissionMode` + チェック 1 個
- **定期実行 UI**: `scheduler.ts` は動いている。名前 / Project / 依頼文 / 頻度 / 有効 を書く画面だけ。
  出力は Inbox に落ちる

---

## 7. 高くつく原則と、成り立たない前提（草案への査読）

草案の 10 原則のうち 8 は成立する。**残り 2 が費用の大半を持っている。**

### 7-1. 原則 6「AI エージェントは交換可能」— 一番高い

同じツールがセル種別ごとに 3 通りの名前で見える:
`mcp__mt__presentChart`（生成した `--mcp-config`）/
`mcp__mulmoterminal-render__presentChart`（ユーザーの `.mcp.json`）/
`mcp__plugin_mulmoterminal_render__presentChart`（インストール済みプラグイン）。**これが税金の領収書。**

さらに **muse は原則 5「MCP は Project のもの」の反例**。`muse plugins install` は
**マシン単位**で記録し、`--scope project` はプロジェクトに何も書かない。
回避として全セッションに 4 サーバを登録し、権利の無いセッションには**空のツールセット**を返している。

**交換可能性は Project レベルで保証し、capability レベルでは保証しない。**

### 7-2. 原則 10「実装詳細を隠す」— バッキングだけは別（3-3）

### 7-3. 半分だけ本当: 「Skills は Project のもの」

`.mulmoterminal.json` の `skills` は**メニュー**であって実体ではない。実体は
`~/.claude/skills` と Codex skills root に**マシン全体**でミラーされている。
Collections が持っている scope の考え方を skills にも延ばすのが筋
（`<project>/.claude/skills` は Claude Code 側が既に読むはず — **未検証**）。

### 7-4. 正しくて安いもの

- **原則 2「テンプレはコードでなく知識」** — 既にそうなっている（設定スキル群）。条件が 1 つ:
  **AI が書いた設定は必ず本物のバリデータを通し、捨てられたキーを報告する。**
  「キーが黙って捨てられる」がこの repo の既知の失敗様式（`mulmoterminal-config` が
  「アプリが実際にパースしたもの」を読むのはそのため）
- **原則 8「Git は任意で隠す」** — **安い当たり**。`git init` + Job 完了時の自動コミットで、
  ユーザーが git を知らないまま「昨日の版に戻して」が動く（ただし 4-3 / 4-6）
- **原則 9「AI がテンプレの進化を提案する」** — **最後で正しい。**
  テンプレが十分使われて改良されるまで、比較する対象が存在しない

### 7-5. 草案に無いもの: 失敗のモデル

1 行も無い。最低限: **同時実行の上限とコスト表示** / **実ファイルの保護**（D3）/
**テンプレ誤選択からの回復** / **AI が書いた設定の検証**（7-4）。

---

## 8. Worker（バックグラウンド）— 別軸、あとで合流

「9 枚のセルを埋めずに用事を投げたい」という別のコメントに対する調査。
Cowork とは動機が違う（**Worker = セルを使わず投げる / Cowork = コード以外の仕事をさせる**）が、
Job が 2 件を超えると同じロスターに合流する。

### 8-1. Claude Code 側の実体（このマシンで実測）

| 実体 | 内容 |
|---|---|
| `claude --bg` | セッションをバックグラウンドエージェントとして起動し即 return。端末を閉じても走る |
| `claude agents` | 走っている全セッションと入力待ちを 1 画面で見る TUI |
| `claude agents --json [--all]` | **TTY 不要で JSON。スクリプト用** |
| `claude daemon status / stop --keep-workers` | worker を supervise する常駐デーモン |

**罠: `claude agents --json` はマシン全体を返すので、MulmoTerminal のグリッドセル自身
（`kind:"interactive"`）が混ざる。** sessionId で registry と突き合わせて除外しないと二重に並ぶ。

### 8-2. 走らせるのは自前（推奨）

Claude の daemon に乗ると **出力が取れず・GUI MCP を差せず・途中で追加指示ができない**。
`spawnBackgroundChat` なら transcript も cost も activity も完了フックも手の内で、
attach も再開もできる。**自前で走らせ、`claude agents --json` は「外で立った仕事」として一覧に出すだけ。**

### 8-3. セルと Worker の往復

- **裏に回す**: 走っているセルを空けるが tmux は殺さない。**これは unplaced セッションそのもの**なので
  新しい寿命管理を発明しなくていい（reap ポリシーも working は元々殺さない）
- **引き上げる**: ロスターの行をグリッドに配置（`/api/sessions/unplaced` の養子取りと同じ経路）

---

## 9. 段階（統合）

| | 内容 | 依存 | 規模 |
|---|---|---|---|
| **上流 A** | collections を任意フォルダで動かす → **[feat-collections-project-root.md](./feat-collections-project-root.md)**（調査の結果、上流は小さく、大半は MT 側だった） | 外部 3 点 + MT | 中 |
| **段階 0** | **resources**（取り込み + 由来 + 抽出サイドカー + read-only）+ Office 変換の同梱 | **依存ゼロ。ここから着手** | 中 |
| 段階 1 | **Inbox**（`artifacts/` を見る場所） | 依存ゼロ | 小 |
| 段階 2 | **Jobs ビュー**（1 件、GuiPanel 再利用） | 依存ゼロ | 中 |
| 段階 3 | フォルダ・プロファイル + 承認モード | 段階 2 | 小〜中 |
| 段階 4 | 定期実行 UI + 上限・コスト | 段階 1 | 小 |
| 段階 5 | Git 自動化（init + 完了時コミット、chrome は静かに劣化） | — | 小 |
| 段階 X | **Project 単位の collections**（+ resources 索引の昇格） | **上流 A 待ち** | 中 |
| 段階 Y | Project 単位の accounting | 上流 + 製品判断 | 中 |
| 段階 Z | Project 単位の wiki（MT に書き込み層） | 最後 | 大 |
| 段階 W | Worker ロスター / 複数 Job 同時 | 段階 2 | 中 |

**段階 0 が最初なのは、これが無いと Inbox も Jobs も
「フォルダが見えていないエージェントに用事を頼む」ことになるから。**

---

## 10. 触ってはいけないところ（CLAUDE.md 由来）

- **通常のグリッドセルの挙動を変えない。** Jobs は view として足す（6-1）
- **新しい spawn 経路を作るなら `carriesFullGuiMcp()` を必ず聞く**
- **ランチャーチップにエージェント判定を戻さない。** チップはユーザーの書いた通りに走る
- **設定は 1 つのスキルが持つ。** ルータは目次のまま。
  Settings セクションを足したら `SkillLaunchButton` を置く
- **`/api/*` の形は MulmoClaude の `apiRoutes.ts` が命名権**（5-3）
- 両側が判断する値は `common/` に置く
- **絵文字を使わない。** アイコンは Material Symbols

---

## 11. 未決

**設計**
1. ~~ワークスペースを「Project の 1 つ」として扱うか~~ → **D7 で決定（扱う）。**
   残るのは `resolveProjectRoot()` の置き場所のみ
2. Project 内データのディレクトリ名（`.mulmoterminal/data/` か、もっと見える名前か）。
   **collections には掛からない** — 既存レイアウトのまま（5-1）。resources 以降の話
3. 上流 A で通す root の粒度（Project ルートか、任意の root か）
4. slug 修飾の形 — **MulmoClaude の `apiRoutes.ts` を見てから**
5. 既存のワークスペース collections の扱い（残す / 移す / 両方見せる）
6. ディレクトリを移動・リネームしたときの追従。今は静かに外れる
7. 原本を git に入れるか（`.gitignore` / LFS / サイズガード）
8. ターミナルをどこまで隠すか（既定で畳む程度か、Jobs では原則出さないか）

**製品**
9. accounting を Project 単位にするか（フォーカスを外す判断）
10. **最初に通す実物の Project を 1 つ。** 架空のマーケ Project からは設計が出てこない
