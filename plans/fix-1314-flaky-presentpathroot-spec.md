# fix #1314 — presentPathRoot.spec.ts が flaky（フルスイートで順序依存に見える fail）

## 症状（起票時）

`yarn test` 1回目で `test/server/backends/presentPathRoot.spec.ts` が 4 件 fail。
同じ作業ツリーのまま単体実行は 11/11 pass、2回目のフルスイートも全 pass。
「無関係な PR が spec を1本足した回に出た」ことから、**テスト間の順序依存 / 状態汚染**が疑われていた。

## 調査

### 1. プロセス間の状態汚染は起こり得ない（実測）

vitest の `isolate` は既定 `true`。スクラッチの2ファイル spec に `process.pid` を出させて確認したところ、
**spec ファイルごとに別プロセス**（PID が違う、`globalThis` も共有されない）。
つまり他の spec がこの spec のモジュール状態・env・cwd に触ることは仕組み上できない。
`--sequence.shuffle.files` を6シード回しても、この spec は一度も落ちなかった。

### 2. テスト対象は決定的

middleware が通る経路は全て字句的な判定だけ：

- `SESSION_ID_RE` — ただの正規表現（`g` フラグ無し＝`lastIndex` の状態も持たない）
- `isSamePath` — `path.resolve` 同士の比較。純粋関数
- `classifyFilePath` / `isPresentableHtmlPath` — 上流が "LEXICAL check only" と明記。fs も env も見ない

入力が同じなら答えは同じ。ロジック側に非決定性は無い。

### 3. 決め手は起票内容そのもの

このファイルは 11 テスト＝**純粋な `absolutizePresentPath` 6 件**＋**`fetch` で実サーバを叩く 5 件**。
落ちた回、**純粋な 6 件は全部通り、実サーバ側の 5 件中 4 件が落ちた**。同じファイル・同じプロセス・同じ瞬間で、
2つのグループの違いは **TCP のラウンドトリップを通るかどうかだけ**。

さらに落ち方は綺麗な prefix：このファイルが投げるリクエストは順に 2,2,1,1,2 の計 8 本で、
失敗した4件はその**先頭 6 本**にあたる。途中で解消した一過性の事象であって、ロジックの誤りではない。

### 4. 傍証：負荷時の犠牲者は「その時いちばん event loop を回していたテスト」

20 コアの機械に `yes` を 16 本足してフルスイートを回すと、**別のテスト**
`test/src/components/GridView.spec.ts` が `Error: Test timed out in 15000ms` で
負荷時 3/3 回・シャッフル 6 シード中 1 回落ちた。
これは `vitest.config.ts` の `testTimeout: 15_000` のコメント（#903）が既に書いている現象と同じ家系。

## 結論（根本原因）

順序依存でも状態汚染でもない。
**決定的な middleware の検証を、必要のない 8 本のソケット往復に載せていたこと**が原因。
ラウンドトリップは純粋な assertion に比べて event loop の回転を桁違いに必要とするため、
ランナーが混んだ瞬間の犠牲者になりやすい。

## 対応

`test/helpers/appRequest.ts` を追加し、Express アプリを**ソケット無し・プロセス内**で叩けるようにする。

- `light-my-request` (fastify org) の `inject` を利用。ハンドラチェーン（`express.json()`、
  ルーティング、`res.status().json()`、静的配信、Range）は本物のまま、ソケットだけがメモリ上になる。
- 返り値は本物の `Response`。`status` / `headers.get()` / `json()` / `text()` / `arrayBuffer()` が
  今までの `fetch` と同じに読めるので、各 spec の assertion は原則そのまま。
- 各 spec からは `app.listen(0)` の `beforeAll` / `server.address()` のポート取り回し /
  `afterAll` の `close()` が消える。

### 移行対象

`listen(0)` を使っていた 14 spec のうち **13 本**を移行する。

移行しないのは `test/server/mcp/bridge.spec.ts` 1本だけ。これは bridge を**別プロセスとして spawn** し、
その子プロセスが HTTP で繋いでくる形なので、実際に listen しているサーバが要る。

### やらないこと

- `GridView.spec.ts` の負荷 flake は根本原因が別（jsdom マウントが重い）なので、この PR では触らない。
- `supertest` を使う既存 spec（別系統）はこの PR の対象外。同じ弱点は持つので、追随は別途判断。

## 検証（外部の ground truth と条件振り）

`git archive origin/main` で**素の main を別ディレクトリに展開**し、同じ機械・同じ負荷で A/B した。

### 1. 実行時間（アイドル、移行した13 spec の `tests` フェーズ）

| | 1回目 | 2回目 | 3回目 |
|---|---|---|---|
| main（実ソケット） | 1.12s | 1.19s | 1.46s |
| このブランチ | 735ms | 854ms | 1.02s |

`presentPathRoot.spec.ts` 単体では 181ms → 34ms（最初の middleware テストは 169ms → 25ms）。

### 2. 負荷下で `testTimeout` を絞る（20コアに `yes` 24本）

`testTimeout` は #1314 の失敗が実際に越えた目盛りなので、そこを締めて先に折れる側を見る。

| testTimeout | main | このブランチ |
|---|---|---|
| 2000ms | 0 fail / 3 run | 0 fail / 3 run |
| 1000ms | 0 fail / 3 run | 0 fail / 3 run |
| 500ms | 2 fail / 3 run | 2 fail / 3 run |
| 250ms | 12 fail / 3 run | 5 fail / 3 run |

**過大評価しないこと**: 250ms まで絞ると両方落ちる。落ちる中身を見ると
`collections` の ontology（skills ディレクトリ走査）、`notifier`（JSON 書き込み）、`translation`（キャッシュ書き込み）で、
**ソケットではなく本物の disk/CPU が理由**。この変更が消したのは「ソケット往復ぶんの余計な露出」であって、
負荷そのものへの耐性ではない。

ただし #1314 が報告した形——**同じファイルの純粋なテストが通り、ソケット越しのテストだけが落ちる**——は、
ソケット越しのテストが1本も無くなったので原理的に起き得なくなる。
