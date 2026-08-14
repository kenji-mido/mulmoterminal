# fix: 大量出力時に PTY を読み切れない（#1506）

## User Prompt

> https://github.com/receptron/mulmoterminal/issues/1501 これ、良いレポートかも。詳しく読んで、対処できそうなものは進めよう。
> １つ１つ具体的に相談を。
>
> （方針確認のうえ）ok ではPR
>
> あと、これに書かれていた他の課題残っていたらかいぜんしていきたいし、この2000msってのもどうにかスピードアップしたいね

#1501 は投稿者が「誤投稿」として取り下げたが、原因の指摘は正しかった。独立に再現・計測したうえで
#1506（本 PR）と #1507（tool-store、別 PR）に分けて対処する。

「2000ms」は計測に使ったシェル自身（`printf` 20 万行）のコストで、mulmoterminal 側ではない。
node を介さないシェル 6 本だけで 1927 ms かかる。修正後の 6 セル 2159 ms はその 12% 増しなので、
**サーバはすでにボトルネックから外れている**。これ以上の短縮対象は本 PR には無い。

## 診断

`appendBoundedOutput`（`server/session/terminal-replay.ts`）は末尾 `limit` 文字を正確に残す関数で、
内部の `slice` が連結文字列を flatten するので **O(limit)**。これを PTY の `onData` ごとに呼んでいる。

上限は #776 で 64 KiB → 1 MiB に拡大済み（再接続後もスクロールバックが ~1000 行残るように）。
その判断は妥当で、問題は追記の計算量が上限に引きずられていること。

計測（macOS / Apple Silicon、実 node-pty、各セル 20 万行、`sendFrame` 相当の `JSON.stringify` 込み）:

| 同時セル数 | 現状 | 修正後 | シェル単体（node なし） |
|---|---|---|---|
| 1 | 2007 ms | 2022 ms | — |
| 3 | 3868 ms | 2125 ms | — |
| 6 | 8230 ms | 2159 ms | 1927 ms |

CPU は 1 コアの 86.2% → 1.4%。1 セルだけなら差は出ず、セル数が増えるほど効く。

「イベントループ飽和で全セルの描画が止まる」（#1501 の主張）は**再現しなかった**。遅延は修正前でも
p99 で 1〜2 ms。1 回 0.1 ms の処理なので、詰まるのではなく常時忙しいという性質。

## 修正

### 1. 追記と切り詰めの分離

`growOutputTail` を足す。`buffer + data` は V8 が rope で持つので O(チャンク)。切り詰めは
`limit * TAIL_SLACK` を超えたときだけ走る。`appendBoundedOutput` は無改造で残す（#434 の分割
シーケンス修復と、それを固定している spec に触らずに済む）。

読み出し側で正確に切り詰める。読み手は 2 箇所:

- `pty-connection.ts` の再アタッチ replay — 切り詰めは `stripTerminalQueries` の**前**
  （後だと正規表現 5 本が上限超の文字列を舐める）
- `server/index.ts` の `remoteHostCaptureTerminalScreen` — tmux が使えないときスマホ画面を
  headless レンダリングするフォールバック。#1501 はここを見落としている

### 2. `TAIL_SLACK = 1.25`

rope はメモリを文字数以上に食う（cons ノード + 小さな leaf 文字列のヘッダ）。1 セッションあたり実測:

| PTY チャンク長 | 現状 | slack=2 | slack=1.25 |
|---|---|---|---|
| 40 B | 1.00 MB | 6.45 MB | 2.54 MB |
| 400 B | 1.00 MB | 3.05 MB | 1.40 MB |
| 1400 B | 1.00 MB | 2.34 MB | 1.30 MB |

速度差はほぼ無い（1.25 で 0.00022 ms/chunk、2 で 0.00027、現状 0.1045）。

### 3. 出力のコアレス

読み切れるようになるぶん 1 回の read が小さくなり、チャンク数が増える（6 セルで 118,115 →
654,683）。1 チャンク = 1 WebSocket フレームのままだと、ボトルネックが `JSON.stringify` +
`ws.send` とブラウザに移るだけ。

`createOutputRelay` に集約する。設計上の要点:

- **idle 直後は即送信**。`FLUSH_INTERVAL_MS` 以上あいていればバッチせずそのまま送る。
  タイマーで一律に遅らせるとキーストロークのエコーが遅れる
- **exit の前に flush**。しないと最後の出力が exit フレームの後になる / 落ちる
- **再アタッチでは pending を捨てる**。replay が送る `entry.buffer` に既に入っているので、
  そのまま flush すると二重に届く。`PtyEntry.output` 経由で `pty-connection` から捨てる
- flush 時に `entry.ws` を読み直す（再アタッチでソケットが差し替わる）

Run メニューの一時 PTY（`spawnCommandPty`）は対象外。バッファを持たず O(limit) の追記も無いので、
そもそも詰まっていない = 開栓もされない。

## 検証

- `growOutputTail` の単体テスト
- **等価性テスト**: ランダムなチャンク境界・エスケープ混在・ランダム上限で、
  「毎チャンク `appendBoundedOutput`」と「`growOutputTail` → 読み出し時に切り詰め」を突き合わせる。
  上限が単一シーケンスより大きい現実的な条件では完全一致。小さい場合は新実装が旧実装の厳密な
  suffix になる（孤児化した OSC ペイロードを余分に捨てるだけで、可視テキストの喪失は無い）ことを固定する
- コアレスのテスト: バッチされること、idle 直後は即送ること、exit 前に flush されること、
  再アタッチで pending が捨てられること
- `yarn format` / `lint` / `typecheck` / `build` / `test`
