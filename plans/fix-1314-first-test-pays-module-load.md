# fix #1314（続き） — 「最初のテストがモジュール読み込み代を払う」問題

#1323 でソケット往復は外したが、#1314 を閉じるにはもう一方の症状 —
**負荷時に `Error: Test timed out in 15000ms` で落ちるテスト** — の原因を潰す必要がある。

## 見つけ方

負荷（20コアに `yes` 24本）をかけてフルスイートを回すと、
`test/src/components/GridView.spec.ts` の**最初のテスト**が 3/3 回タイムアウトした。
そこで「機械が遅いから」で終わらせず、スイート全体で 300ms を超えるテストを実測して並べた。

## 根本原因（計測で確定）

同じファイルの中で **最初のテストだけ 2453ms、残り30本は 2〜10ms**。
その1本を計測器で割ると：

```text
import=2132ms  mount=18ms  flush=2ms
```

つまり 2.4 秒の正体は**モジュール読み込み**であって、テストの仕事ではない。

`await import("…/GridView.vue")` をテスト本体（や `it` が await するヘルパ）の中で呼ぶと、
そのコンポーネントの**モジュールグラフ全体の transform** が走る。キャッシュされるので払うのは
一度きりだが、**払わされるのはそのファイルで最初に走ったテスト**で、しかもそれが
`testTimeout` に課金される。アイドルなら 2.4s で収まるが、ランナーが混むとここが最初に 15s を越える。

「一番重い処理をしていたテストが犠牲になる」という #903 / #1314 の見立ては合っているが、
**その重い処理はテストのものではなかった**、というのがこの件の答え。

## 対応

モジュールスコープで一度だけ読む（`GuiPanelCollapse.spec.ts` が既にこの形だった）。
collection 時に払われるので、テストごとの予算に一切乗らない。

```ts
const GridView = (await import("../../../src/components/GridView.vue")).default;
```

### 直した4ファイルと効果（そのファイルの最遅テスト）

| spec | before | after |
|---|---|---|
| `cellChromeColors.spec.ts` | 11084ms | 44ms |
| `terminalViewInput.spec.ts` | 7452ms | 16ms |
| `TerminalDirFontApply.spec.ts` | 6540ms | 17ms |
| `GridView.spec.ts` | 2453ms | 28ms |

この4テストだけで **27.5秒 → 約0.1秒**。`cellChromeColors` は 11.0s で 15s の上限まで
あと4秒しかなく、次に CI を赤くするのはこれだった。

### 触らなかったもの（同じ形に見えるが違う）

- `codeBlockCopy.spec.ts` と `test/server/**` の数本 — `vi.doMock` / `vi.resetModules` は
  **ホイストされない**ので、後から import しないとモックが効かない。意図的な形なので残す。
- `probe-transcript.spec.ts`（9700ms）— 600個のファイルを実際に作って掃く規模テスト。本物の I/O。
- `terminalBufferHealth.spec.ts`（6554ms）— 実 xterm を動かす。import は既に静的。
- 残りの in-body `await import()` は小さいモジュールで、300ms を超えるテストに一つも現れない。

## 再発防止

`CLAUDE.md` の「Run after changes」に節を追加した。`vi.doMock` / `vi.resetModules` の例外も
明記してあるので、次に spec を書く人が一律に禁止と読まないようにしている。

## 検証

- `format` / `lint`（0 error）/ `typecheck` / `build` — green
- フルスイート **4回連続で 7621 passed / 45 skipped / 0 failed**（うち1回はコメント整理後）
