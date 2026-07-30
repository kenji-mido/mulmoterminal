# fix: 自動リロード後に通知音が黙って失われる (#1152)

## 症状

タブをプログラムからリロードした直後、最初のクリック／キー入力まで `finished` / `waiting` の
通知音が鳴らない。その間に発生した通知は後から届かず、ツールバーは `Attention sound on` の
まま。取り逃がしたことに気づく手段が無い。

## 原因（2つ）

### A. リロード直後の AudioContext が suspended のまま

ジェスチャ無しで音が鳴らないこと自体は Chrome の Autoplay Policy で、アプリ側では回避できない。
sticky activation はドキュメント単位なので、リロードで必ず破棄され、読み込み直後は常にブロック
状態から始まる（Cmd+R でも同じ。今回は自動リロード後に誰もタブを触らなかったので窓が開いたまま
になった）。

アプリ側のバグはその周辺にある。

1. **suspended 中は `AudioContext.currentTime` が 0 で凍結する**のに、`useAttentionSound.ts` は
   `osc.start(ctx.currentTime + …)` で予約し続ける。無音期間の通知が全部「時刻 0」に積み上がり、
   resume した瞬間に重なって一斉に鳴る。Chromium で実測（suspend した context に 1 秒あけて 2 回
   スケジュール → resume で両方が `0.181` に終了）。ユーザーからは「後から鳴らない」に見える。
2. `armUnlock()` が window の **bubble** フェーズ登録なので、`GridView.vue` が capture フェーズで
   `stopPropagation()` するショートカットキーでは unlock されない。また resume の成否に関わらず
   リスナーを外すので再武装しない。
3. `AppToolbar.vue` は `soundEnabled` しか見ないので、ブロック中でも `Attention sound on` と表示する。

### B. リロード後の最初の 1 行がベースラインに食われる（ブラウザと無関係）

`notifyKind.ts` の `if (!was) return null;` によりセッションの初出は必ずベースライン扱い。
`prev` マップはリロードでリセットされ、サーバは購読時にスナップショットを流さない（publish は
`setFlag` 経路と created / closed のみ、しかも値が変わらないと publish しない）。結果:

- `finished`（非アクティブペイン）: Stop が 2 行 publish するので 2 行目で拾えて助かる
- `waiting`（アイドルへの Notification）: publish が 1 行だけ → **音声がブロックされていなくても
  リロード後の最初の 1 回は必ず鳴らない**
- アクティブペインの Stop も 1 行だけなので同様

## 方針

issue の「期待する結果」3 つにそのまま対応させる。

| # | 期待 | 対応 |
|---|---|---|
| 1 | ブロック中だと UI に明示 | ツールバーに第 3 状態を出す |
| 2 | ブロック中の通知を保留し、再生可能になったら一度通知 | ビープをキューに退避して flush 時に 1 回だけ鳴らす |
| 3 | 取り逃がした注意状態の視覚的な未確認マーク | セッションごとの未確認マークをセルに出す |

③ は「購読時スナップショット」ではなく視覚マークを選ぶ。スナップショットにするとリロードのたびに
既存の `waiting` が一斉に鳴る事故が起きるため。

## 変更

### 1. `src/composables/pendingBeep.ts`（新規・純粋）

保留中のビープを 1 件だけ持つ小さなストア。`hold` / `take` / `clear`。複数溜まっても最新 1 件に
畳まれる（= issue の「一度通知する」）。AudioContext 非依存なので単体テストできる。

### 2. `src/composables/audioUnlockState.ts`（新規）

`AudioContext.state` を Vue の ref に載せる singleton。`audioBlocked` は
`state !== null && state !== "running"`（Safari の `interrupted` も拾う。`null` は context 未生成
＝不明で、ブロックとは言わない）。ツールバーがプレイヤー本体を import せずに済むように分離。

### 3. `src/composables/useAttentionSound.ts`

- `getCtx()` で生成時に `statechange` を購読し、`audioUnlockState` へ反映。running に変わったら
  登録済みの resume リスナーを呼ぶ。
- `playNotify()` に**ゲート**を追加: context が running でなければスケジュールせず `hold()` する。
  ここが「時刻 0 への積み上げ」を止める本体。
- `playChime` / `playBuffer` からその場の `resume()` を外す（呼び側が状態を決める）。
- `previewNotify()` は**ジェスチャ内で呼ばれる**ので、逆に fetch を待つ前に `resume()` する。
- `armUnlock()`: capture フェーズで登録し、`resume()` が実際に成功するまでリスナーを外さない。
- `useAttentionSound()`: `enabled` が true になったら context を先に作る（ブロック中であることを
  最初の取りこぼしより前にツールバーへ出すため）。resume 時に保留ビープを flush。`enabled` が
  false になったら保留を捨てる。

### 4. `src/composables/missedAttention.ts`（新規・純粋）+ `useMissedAttention.ts`（singleton）

「通知が発生したのに知らせられなかったセッション」の id 集合。

- **付ける**: (a) 初出の行が既に `waiting: true`（= 告知できなかった注意状態）、
  (b) 鳴らすべきビープを保留した（ブロック中）
- **外す**: `waiting` が false になった行、`closed`、またはユーザーがそのセルを拡大した
- 判定は純粋関数 `missedMarkFor()` に切り出してテストする

### 5. `src/components/soundButtonState.ts`（新規・純粋）+ `AppToolbar.vue` + `LauncherButton.vue`

`sortModeButton` と同じ形で、`(enabled, blocked)` から icon / label / tone を返す。

| 状態 | icon | tone | label |
|---|---|---|---|
| off | `notifications_off` | — | Attention sound off |
| on / 再生可 | `notifications_active` | accent（青） | Attention sound on |
| on / ブロック中 | `notifications_paused` | warn（アンバー） | Attention sound blocked - click anywhere to enable |

`LauncherButton` に `tone?: "accent" \| "warn"` を足す。実機で撮って確認したが、19px の
アイコン差だけでは隣の青い active ボタンと見分けがつかず、色が必要だった。親から `class` を
被せる案は採らない — active の `bg-*` と競合して、どちらが勝つかを Tailwind の出力順が決めて
しまう（`cellChromeClasses.ts` が繰り返し警告している落とし穴）。

### 6. `src/components/TerminalCell.vue`

未確認マークがあるセッションのステータスドットに ring を足し、`title` に理由を足す。要素は
増やさない（レイアウトに触らない）ため。拡大したら acknowledge する。

## 検証

- `yarn test`（新規 spec: pendingBeep / missedAttention / soundButtonState）
- `yarn format` → `yarn lint` → `yarn build` → `yarn typecheck` / `typecheck:server` / `typecheck:test`
- ブラウザ実機: suspended 状態を作って（devtools で新規タブを開いて触らない）通知を発生させ、
  ツールバーが `notifications_paused` になること、クリック 1 回で**まとめて 1 回だけ**鳴ること、
  取り逃がしたセルに ring が付くことを確認

## やらないこと

- ジェスチャ要件そのものの回避（ブラウザ仕様なので不可）
- 購読時 activity スナップショットの追加（リロードのたびに一斉に鳴るリスク。#1152 のコメント参照）
