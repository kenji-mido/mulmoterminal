# fix #1178 — ターミナルのサイズが二度と更新されなくなる経路を塞ぐ

## 症状

拡大したセル（切り替えた先のセッション）が、パーク時の幅のまま描画される。テキストが端末の
左 55〜60% で折り返り、右が空く。リロードすると拡大中の 1 枚は直るが、そこから切り替えた先が
同じ状態になっていることが多い。セッションが 10 を超え、初回ロードが遅いときに出やすい。

## 測定でわかったこと

- スクリーンショットの幾何: xterm は約 237 桁、アプリは約 131 桁で描画。
- その時点の tmux 上のセルは全部 131x41 = パーク（非拡大）セルのサイズ。
  → **拡大したセルの PTY がパーク時のサイズのまま**。

別ポートに立てた実サーバでの計測では、次はいずれも常に正しいサイズになった（＝原因ではない）:
12 本同時接続の open 直後 resize / セル 6〜12 枚のコールドロード / サーバ再起動＋再読込 /
拡大とロスターの高速切り替え。

## 原因（実証済み）

`Terminal.vue` の `onUnmounted` は `conn.detach(slotKey, terminalRef.value ?? null)` を呼ぶが、
Vue はテンプレート ref を `unmounted` フックより前に null にする（テストで確認）。よって

```ts
if (el && c.attachedEl !== el) return; // a newer attach already took over this slot
```

は一度も発火しない。どの unmount も無条件に `attachedEl` を消し、xterm の host を DOM から外す。
`fit()` は `if (!c || !c.attachedEl) return;` で始まるので、一度この状態に落ちたスロットは
**二度と fit されず・resize フレームを送らず・`term.refresh` もされない**。PTY は最後のサイズで
凍り、ブラウザだけが新しい幅で描く。#957 の「塞がっていなさそうな箇所」2 番目と同じ場所。

## 直す範囲

### A. `detach` のガードを実際に機能させる
`Terminal.vue` が mount 時の host 要素をローカルに保持し、それを `detach` に渡す。これで
「新しい attach が既にこのスロットを持っている」場合に古い unmount が奪わない。

### B. `fit()` を「死んだら終わり」にしない
`attachedEl` が null でも host がまだ DOM にいるなら、その親を attach 先として復元してから
fit する。ブックキーピングが壊れても画面に出ている限り復帰できる。

### C. 拡大/縮小の切り替えでサイズを再送する
zoom の teleport は unmount を伴わないので、今は ResizeObserver だけが頼り。`expanded` の
watcher（refocus と同じ 2 点: nextTick と FLIP 着地後）で `conn.fit` を呼ぶ。

### D. PTY をブラウザの幾何で生む
- WS URL に `cols`/`rows` を載せ（`wsUrl.ts`）、サーバは範囲チェックした上で spawn 時のサイズに使う。
  取りこぼしようのない経路でサイズが渡るので、最初のフレームが失われても既定の 120x30 で描かれない。
- `/ws`（claude）にも early-frame バッファを入れる。codex / launch / antigravity は
  `announceSession` + `startAndWire` で既に塞いであり、claude だけが素通しだった。

### E. アクティブになった時点でサイズを検証する
`view` フレーム（ペインが見られている状態になった合図）で、ブラウザが最後に要求したサイズと
tmux の実サイズを突き合わせ、食い違えば記録して直す。今は resize フレームが来たときしか
検証されないので、静かにずれたまま残る経路がある。

## テスト

- `detach` が「新しい attach が持っているスロット」を奪わないこと（要素を渡した場合）
- `fit` が `attachedEl` を失ったスロットを host の親から復元すること
- `wsUrl` が `cols`/`rows` を載せること・範囲外を載せないこと
- サーバが URL のサイズを読み、範囲外を既定値に落とすこと
- `view active` でサイズ検証が走ること
