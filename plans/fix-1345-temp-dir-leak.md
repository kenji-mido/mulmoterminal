# fix(test): 一時ディレクトリを消さないテストを止める (#1345)

## 実測

修正前、フルスイート 1 回で **51 ディレクトリ**が `$TMPDIR` に残る。

```console
$ ls "$TMPDIR" | grep -c '^mt-'
51
$ yarn test
7713 passed
$ ls "$TMPDIR" | grep -c '^mt-'
102
```

51 → 102 なので、**1 回で 51 リーク**。

issue が報告した累積 4.2 万件は、この 51/回 が積み上がったもの。**この 51 が 0 になることが受け入れ条件**で、
「掃除するコードを書いた」ではなく「走らせて数えて 0」で判定する。

## リーク元の内訳（実測した 51 件を prefix から辿った結果）

| 出所 | 件数 | 作り方 |
| --- | --- | --- |
| `test/server/config/dir-model-choice.spec.ts` (`mt-dir-choice-`) | 18 | 生 `mkdtemp` |
| `test/server/config/worktree-dir-config.spec.ts` (`mt-wtcfg-` / `mt-wt-`) | 17 | `makeTempDir` |
| その他 14 spec（`mt-wiki-` / `mt-thumb-` / `mt-col-` ほか） | 各 1〜2 | 両方 |
| `server/agents/rate-limit-probe.spec.ts` (`mt-ratelimit-`) | 2 | **製品コードが作る** |

**製品コードにリークは無い。** `server/agents/rate-limit-probe.ts` は `stop()` で
`rmSync(dir, { recursive: true, force: true })` を実行しており、正しく後始末している。
`mt-ratelimit-` が残るのは spec 側が `startRateLimitProbe(...)` の戻り値を捨てて `stop()` を
呼んでいない 2 箇所（`rate-limit-probe.spec.ts:104`, `:151`）が原因。同じファイルの 165 行目の
コメントが「戻り値を捨てると PTY を持ったままになる」と既に警告しており、その 2 件が漏れている。

## 方針: 呼び出し側 20 ファイルを個別に直さない

`test/support/tempDir.ts` の `makeTempDir()` は作るだけで削除を登録しないため、**呼び出し側が
全員リークする**。ここに後始末を持たせれば、呼び出し側は 1 行も変えずに大半が解決する。

生 `mkdtemp` の spec は**ヘルパーへ寄せる**。個別に `rmSync` を足すのは、次に書かれる spec が
また同じ穴を開けるので採らない（`enableAutoUnmount` を global setup に置いたのと同じ判断 —
`test/setup-auto-unmount.ts` のコメント参照）。

### なぜ setup ファイルなのか

`makeTempDir` は **`it` の中からも、spec のモジュールスコープからも**呼ばれる。後者では
`afterEach` を登録できないので、ヘルパー自身が登録する形は成立しない。

このリポジトリには `setupFiles: ["./test/setup-auto-unmount.ts"]` という前例があり、setup ファイルは
**各テストファイルと同じモジュールコンテキストで実行される**ので、そこで `afterAll` を登録すれば
ファイル内のどこで作られた分も拾える。

ただし「setup ファイルと spec が同じレジストリ実体を見る」ことは**仮定なので検証する**。
モジュールが分離されていればレジストリが空のまま `afterAll` が走り、**掃除したつもりで何も消えない**
——テストは緑のまま、リークだけ残る。よってこれを固定するテストを書く。

## 実装

1. **`test/support/tempDir.ts`** — 作ったパスをモジュールスコープの配列に記録し、
   `removeTrackedTempDirs()` を export する。削除は `{ recursive: true, force: true }` で、
   **例外は握って先へ進む**（spec が自分で消していた場合や、Windows でハンドルが残っている場合に、
   後始末が原因でテストを赤くしてはいけない）。
2. **`test/setup-temp-dirs.ts`（新規）** — `afterAll(removeTrackedTempDirs)` を登録。
   `vitest.config.ts` の `setupFiles` に追加する。
3. **生 `mkdtemp` の spec を `makeTempDir` へ移行** — 実測でリークしていたものを対象にする。
4. **`rate-limit-probe.spec.ts` の 2 箇所で `stop()` を呼ぶ** — ヘルパーでは拾えない
   （製品コードが作るディレクトリなので）。ついでに PTY も解放される。
5. **回帰テスト** — レジストリが実際に効いていること、および `removeTrackedTempDirs()` が
   例外を投げないことを固定する。

## 検証

- `ls "$TMPDIR" | grep -c '^mt-'` をフルスイートの前後で取り、**差が 0** であること
- `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test`
- ミューテーション: レジストリへの記録を外すと回帰テストが赤くなること
