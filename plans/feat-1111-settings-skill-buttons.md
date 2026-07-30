# Settings の各セクションから、その設定を書く skill を起動する (#1111)

## 何を直すのか

#1104 で config skill を 6 本に割ったが、Settings 側の入口は 1 つのまま
（`mulmoterminal-dirs` の「Configure appearance…」）。残り 5 本は、スキルの存在を
知っている人が自分でターミナルに `/mulmoterminal-theme` と打つ以外に届かない。

これは導線の不足ではなく **可視性の欠落** に近い。Settings は「そこにある設定」しか
見せないので、UI を持たない設定は *出来ないこと* として読まれる:

- Theme セクションは既存 4 テーマから選ぶだけ。`themes` を書けば増やせることが出ていない
- Keyboard shortcuts は read-only で、`/mulmoterminal-keys` が**本文の文字**として書いてある
- Directory settings は「効いていない設定」を表示するが、それを**直す**手段が繋がっていない

## やること

### 1. 起動経路を skill 名でパラメータ化する

今は `configure-appearance` という、skill 名がイベント名に焼き込まれた emit:

```
SettingsModal ──@configure-appearance──> AppSettingsModal ──> App.vue / GridView.vue
                                                              └ startCollectionChat(skillSeed(DIR_CONFIG_SKILL, "claude"))
```

これを `launch-skill(skill: BundledSkillName)` にする。ハンドラは受け取った名前を
そのまま `skillSeed()` に渡すだけになり、**ボタンを足すのに shell 側の変更が要らなくなる**。

`BundledSkillName` で縛るのが要点 — 存在しない slug を書いても実行時までは
「スキルが見つかりません」とターミナルに出るだけで、typecheck も lint も test も通る。
型で縛れば書いた瞬間に落ちる。

`DIR_CONFIG_SKILL` は残す。JSON Schema をどのスキルの隣に置くかを
`server/infra/install-bundled-skills.ts:62` が決めるのに使っている（UI の入口とは別の役割）。

### 2. `SkillLaunchButton.vue` を 1 つ作る

5 箇所が同じ形（`SettingsButton` + `material-symbols-outlined` の span + emit）になるので、
`skill` / `icon` / `label` を取る小さなコンポーネントに寄せる。
`skill` の型が `BundledSkillName` であることが、上の型縛りの実体。

### 3. 既存 4 セクションにボタンを足す

| セクション | skill | icon | ラベル |
|---|---|---|---|
| Theme | `mulmoterminal-theme` | `format_paint` | Create a theme… |
| Directory settings | `mulmoterminal-config` | `troubleshoot` | Explain my settings… |
| Notification sounds | `mulmoterminal-notify` | `notifications_active` | Configure notifications… |
| Keyboard shortcuts | `mulmoterminal-keys` | `keyboard` | Set up shortcuts… |

Directory appearance の既存ボタンは新しい経路に載せ替えるだけで見た目は変えない。

各セクションの説明文には **skill が Settings より先に出来ること** を 1 行足す
（例: Theme なら「Settings は既にあるテーマを選ぶだけ」）。ボタンだけ置くと、
UI で出来ることの繰り返しに見えて押されない。

Keyboard shortcuts の本文にある `Ask <code>/mulmoterminal-keys</code> to set them up` は
ボタンに置き換える（同じことを 2 回言わない）。guide へのリンクは残す。

### 3b. 押した画面で開く — グリッドはグリッドのセルに

最初の実装は、グリッドの Settings から押しても `router.push({ name: "chat" })` で **single view に飛んで**
いた（`-dirs` の頃からの挙動）。押した本人からは *アプリが居場所を失った* ように見える——ボタンを押した
画面と、戻ってきた画面が違う。ボタンが 1 個から 5 個に増えたぶん踏む回数も増える。

グリッドから押したときは**グリッドのセル**として開く:

```
startCollectionChat(seed, { hidden: true })  →  chatId
insertCellAfter(state, NO_ORIGIN_UID, { session: chatId, cwd: defaultCwd })
```

**なぜ spawn してから引き取るのか。** 素の claude セル（`{ session: null, cwd }`）には最初の 1 ターンを
渡す経路が無い。プロンプトを種として渡せるのは `/api/plugin/spawnBackgroundChat` だけなので、先に session を
立ててからセルに引き取らせる。セルは `initialSessionId` があれば `launched` で起動するので、これは
**リロード後の再アタッチと同じ経路**であって新しい仕組みではない。

`hidden: true` は「single view のオープナを呼ばない」というクライアント側だけの意味（サーバには送られない
ので、background worker 扱いにはならない）。これが飛ばないことの実体。`startCollectionChat` は
chatId を返すようにした——`hidden` にすると呼び出し側は自分が起こしたものへの手掛かりを失うため。

**満杯のとき。** `insertCellAfter` は `MAX_TERMINALS`（81）でセルを黙って捨て、state をそのまま返す。
先に spawn しているので、そのままだと**生きたエージェントが、グリッド上に出る場所を持たない**まま残る。
満杯なら single view にフォールバックする（従来の挙動）。消えるよりはマシ。

判定は **spawn の後**に、`insertCellAfter` の**戻り値の同一性**で見る。最初は spawn の前に
`runningCount() < MAX_TERMINALS` を数えて `hidden` に渡していたが、それは TOCTOU だった——spawn の
往復の間に上限を跨ぐと、先に取った答えが嘘になり、hidden で立てた session が置き場所を持たない。
**容量を決めている関数に判定させる**のが正しく、`hidden: room` という反転したフラグも消える。
そのために `showSpawnedSession()` を切り出した（非 hidden な spawn がやっていることを、独立した一手に）。

### セルは agent も持たなければならない

spawn は Claude/Codex/Antigravity トグル（`launchAgent`）に従う。`Cell.agent` は「claude は不在」なので、
`{ session, cwd }` だけのセルは **codex の session を claude として** 扱い、再接続が `/ws/codex` では
なく claude のエンドポイントに向かう。旧 single view 経路は `openSessionFn(id, { agent })` で agent を
受け取っていたので、この取り落ちは grid 経路を足したときに入ったもの。

- `startCollectionChat` は `SpawnedChat { id, agent }` を返す。agent が id と一緒に旅するのは、受け取った
  側がトグルを読み直すと **1 つの事実に 2 つの出所** ができるため。
- `sessionCell()`（`shellCell` と同じ形）を `gridTabs` に置く。claude のときは **キーを書かない** —
  `exactOptionalPropertyTypes` の下では `agent: undefined` の明示と不在は別物で、永続セルが通る JSON を
  生き残るのは後者だけ。`setCellAgent` のコメントが警告している罠と同じもの。

single view から押したときは今のまま single view で開く。押した画面で開く、が両方向で同じ規則になる。

## テスト

`SettingsModal.spec.ts` に、レンダリング結果から**列挙した** skill 名が全部
`BUNDLED_SKILL_NAMES` に実在することを pin する（手で書いた一覧を、同じ一覧から書いたチェックが
承認してしまうのを避ける）。#1103 の Codex レビューで潰したのと同じ種類の不具合——名前が
コード上で二重管理され、片方だけ rename される——が、ボタンが 5 つに増えた分だけ再発しやすい。

`GridView.spec.ts` には**依存している条件を動かした**4 本:

| 何を | なぜ |
|---|---|
| セルが 1 個増え、`/mulmoterminal-theme` が種として渡る | 幸せな経路 |
| claude では `agent` キーが**付かない** | 明示 `undefined` は JSON を生き残らない |
| codex / antigravity ではセルに**その agent が載る** | 載せ忘れると claude として繋ぎに行く |
| single view のオープナが**呼ばれない** | 飛んでいた回帰そのもの |
| 現在ページが満杯（9 セル）でも**画面に見える** | 見えないセルは「押しても何も起きない」と区別できない |
| 81 セル（上限）では single view にフォールバックする | session を失わない |

全て、実装をわざと壊して落ちることを確認済み（セル挿入を消す / 同一性判定を外す / `page` ジャンプを
消す / `sessionCell` を常に書く・一切書かないの両方向）。

`launchAgent` は export された ref を直接動かす。`vi.resetModules()` だとテストとコンポーネントに
**別の** `useChatLauncher` のコピーが渡り、片方が登録したオープナがもう片方から見えなくなる
（実際にそれで既存テストが落ちた）。

## 非目標

- `mulmoterminal-header` / `mulmoterminal-model` 用の **新しい Settings セクション**。
  この 2 つは対応する UI が Settings に無く、ボタンを置く節が存在しない。
- 設定キーの追加・変更・改名。
