# fix(#1595): PTY の fd がリークし、ptmx 上限到達で新規セッションが起動不能になる

## 症状

サーバを数日連続稼働させると、新しいセッションが一切起動できなくなる。

```
[forkpty: Device not configured]
```

サーバプロセスが `/dev/ptmx` を掴んだまま離さず、macOS の `kern.tty.ptmx_max`（既定 511）に達する。
回避策はサーバの再起動しかない。

## 原因

報告 (#1595) は「`kill()` はシグナルを送るだけで master fd を閉じない。node-pty の `destroy()` を
呼んでいないのが原因」と分析していたが、**これは誤り**だった。実測した結果を以下に示す。

### master fd は正しく閉じられている

`spawn → kill → onExit` を待ってから自プロセスの fd を数えると、`destroy()` の有無で差が出ない。

```
mode=kill    後: ptmx +20
mode=destroy 後: ptmx +20     ← destroy() を呼んでも 1 本も減らない
```

1 本ずつ追うと **1 spawn = 3 fd** で、終了時に閉じるのは 1 本だけ。

```
spawn 直後                     終了後
fd 11  /dev/ptmx 15,85    →   fd 11  /dev/ptmx 15,85   ← 残る
fd 12  /dev/ptmx 15,86    →   （閉じた）               ← master。正常に閉じる
fd 13  /dev/ttys086       →   fd 13  (revoked)         ← 残る
```

master fd は node-pty 自身の `onexit → setTimeout(200ms) → _socket.destroy()` 経路
（`unixTerminal.js`）で閉じている。`destroy()` が閉じようとするのはこの既に閉じた fd なので、
呼んでも効果がない。漏れているのは **JS から一切触れないネイティブ側の 2 本**。

この模型は実機とも一致する。稼働中サーバの観測値は、生存セッション 9 × 2 + 死亡 37 × 1 = 55 で、
実測の ptmx 55 本・revoked 37 本と 2 サンプルとも完全に一致した。

### 真因は node-pty 1.1.0 の `src/unix/pty.cc`（macOS 専用パス）

`pty_posix_spawn()` にバグが 2 つある。

**(a) 親側の `close(slave)` が無い。** `posix_spawn_file_actions_addclose` は子プロセスの fd を
閉じるだけで、親が握った slave はプロセス寿命の間残る（= `(revoked)` fd）。

**(b) `low_fds` の off-by-one。**

```c
for (; count < 3; count++) {
  low_fds[count] = posix_openpt(O_RDWR);
  if (low_fds[count] >= STDERR_FILENO)
    break;
}
...
for (; count > 0; count--) {
  close(low_fds[count]);
}
```

解放ループは `low_fds[0]` を絶対に閉じない。しかも最初の `posix_openpt` が `STDERR_FILENO` 以上を
返せば（通常はそう）`count == 0` のまま break するので、ループが 1 回も回らない。これが
「余分な `/dev/ptmx`」の正体で、**pty を 1 本まるごと確保したまま**になる。`ptmx_max` を食い潰して
いるのはこちら。

`kill()` の有無とは無関係なので、子プロセスを自然終了させても同じだけ漏れる。

## 方針

**依存を `node-pty@1.2.0-beta.15` に上げる。** リポジトリ側のコードに直せる箇所は無い（漏れている
fd はネイティブが開き、JS に公開されていない）。beta 側のソースには両方の修正が入っている。

```c
    close(slave);                                            // (a)
    for (size_t i = 0; i <= count; i++) {                    // (b)
      close(low_fds[i]);
    }
```

`^1.1.0` のままでは prerelease は解決されないので、**バージョンを明示指定**する。

beta 側の解放ループも完璧ではない: `posix_openpt` が 3 回連続で失敗（`-1` を返す）すると `count == 3`
まで進み、`low_fds[3]` を読む。ただしこれは `int low_fds[3]` の範囲外で、**pty が既に枯渇している状況**
でしか起きない。1.1.0 の `for (; count > 0; count--)` も同じ経路で範囲外を読むうえリークもするので、
この版に上げることで悪化する点は無い。上流の課題として置く。

なお `posix_openpt` が **成功しながら** `count` が 3 に達することはない。`STDERR_FILENO` 未満の
fd は 0 と 1 の 2 つしかなく、ループ内で閉じないので 3 回目は必ず 2 以上を返して break する。

### 採らない案

- **`destroy()` を全 `kill()` 呼び出し箇所に足す**（#1595 の提案 1・2）。実測で 1 本も減らないので、
  効果のないコードを 4 箇所に増やすだけになる。
- **`ProbePty` に `destroy()` を足す**（同 2）。同上。プローブがリーク量の大半を占めるのは事実だが、
  それは「10 分ごとに確実に spawn する経路だから」であって、`destroy()` で止まるものではない。
- **`sysctl kern.tty.ptmx_max` を上げる**。到達を遅らせるだけで、同じペースで再発する。

## 検証

### 実測（fix 前 / fix 後）

同一マシン・同一 Node (v24.12.0)・同じ spawn オプションで、終了経路を変えて比較する。

| 終了のしかた | 1.1.0 | 1.2.0-beta.15 |
|---|---|---|
| `kill()` で殺す（idle） | ptmx 30 + revoked 28 | 0 |
| 出力中に `kill()` | ptmx 30 + revoked 30 | 0 |
| 自分で exit（kill しない） | ptmx 30 + revoked 30 | 0 |
| `sleep 300` を `kill()` | ptmx 30 + revoked 30 | 0 |
| 300 連続 spawn | — | 0 |

本リポジトリの実経路（`lifecycle.ts` と同じ「tmux attach を kill してから kill-session」）でも:

```
node-pty 1.1.0          | tmux attach + kill N=20 -> leaked ptmx=20 revoked=20
node-pty 1.2.0-beta.15  | tmux attach + kill N=20 -> leaked ptmx=0  revoked=0
```

### リグレッションテスト

`test/server/session/pty-fd-leak.spec.ts` を追加する。`spawnPty` を N 回起こして kill し、
`/dev/ptmx` fd が 1 本も増えないことを確かめる。

これはサードパーティの挙動を固定するテストだが、それでいい: 直したのは依存のバージョンだけなので、
**次に node-pty を上げた誰かが同じ穴に落ちるのを止める**のがこのテストの仕事になる。バージョンを
assert するのではなく実際の fd を数えるのは、1.2.0 正式版や将来の版で直り続けているかを見たいから。

macOS 限定（バグが `#if defined(__APPLE__)` の中にあり、fd の数え方も `lsof` 依存）なので、
それ以外と `lsof` が無い環境では skip する。

### API 互換

リポジトリが使っているのは `pty.spawn / pid / write / onData / onExit / resize / kill / cols / rows`
のみ。typings の差分は追加と deprecated だけで、削除は無い。

- `resize(cols, rows, pixelSize?)` — 第 3 引数が任意で追加
- `useConpty` が `@deprecated`（本リポジトリは未使用）

### 確認が要る点

- **beta である。** 公開は 2026-08-03、`latest` タグはまだ 1.1.0。
- **beta は linux prebuilds を同梱する**（1.1.0 は darwin/win32 のみ = Linux はソースビルド）。
  インストール挙動が変わるので CI の linux ジョブで見る。
- `server/fix-pty-perms.js` は残す。beta の tarball は `spawn-helper` を 755 で同梱していたが、
  hoisting 次第で 644 になる経路は塞がっていない。
