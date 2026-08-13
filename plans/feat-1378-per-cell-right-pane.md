# feat(grid): 右ペインの開閉をセルごとに持つ (#1378)

## 何を変えるか

グリッドの右ペインについて、**「開いているか」と「何が開いているか」をセルごとに持つ**。
セルを切り替えると、そのセルの状態に切り替わる。

いまグリッド全体で 1 値なのは、この 2 つだけ（`TerminalGrid.vue:155,186`）。
「何を映すか」は既にセル単位になっている:

| 何 | 今の紐づけ | この変更後 |
| --- | --- | --- |
| 開いているか / どのペインか | **グリッドで 1 値**（localStorage `files_pane_open`） | **セルごと** |
| files が開いていたファイル・展開ツリー | セル(uid) ごと + cwd ごと（#958） | 変更なし |
| files の編集バッファ | 保持しない（出る前にディスク保存、無理なら backup） | 変更なし |
| canvas の中身 | セッションごと・サーバ（`/api/agent/toolResults/:id`） | 変更なし |
| 幅 / 全画面 | グリッドで 1 値 / 記憶しない | 変更なし |

## 決めたこと

| 論点 | 決定 |
| --- | --- |
| まだ開いたことのないセル | **閉じた状態で始める**。自分で開いたセルだけが開く |
| リロード後 | **sessionId をキーに localStorage から復元**（uid はリロードで変わるため） |
| 幅 `paneWidth` / 全画面 `paneExpanded` | **共有のまま**（`paneExpanded` は「記憶しない」が既存の設計判断） |
| セル移動時に files の保存が失敗したら | **既存の「ペインがズームに追従せず前のセルに留まる」挙動をそのまま使う**。新しい概念を足さない |

## 踏んではいけない罠

**ズームを閉じてもペインは unmount していない。** `zoom-row` は `hidden` になるだけ
（`TerminalGrid.vue:983`）で、FilesPane は mount されたまま — だからいまはズームを閉じて開き直しても
編集中のバッファごと残る。

ここで「表示するペイン = `props.expandedUid` のセルの状態」と素直に書くと、**ズームを閉じた瞬間に
uid が null → ペインが閉じる → FilesPane が unmount → 毎回 flush** になり、今より悪くなる。

逃げ道は既にある。**`paneUid`（`:532`）が「ペインが今どのセルに乗っているか」**という意味の ref で、
ズームに追従しつつ、ズームを閉じている間は最後のセルに留まる。これを files 専用から
**ペイン全体の identity に一般化**する。新しい ref を増やさない。

## 実装

### `TerminalGrid.vue`（実質このファイルだけ。`rightPane` の参照は 24 箇所、代入は 1 箇所）

1. `rightPane` を ref から **computed** にする。実体はセル別 Map:

   ```ts
   const paneByCell = ref(new Map<number, RightPane>()); // 不在 = 閉じている
   const rightPane = computed(() => (paneUid.value === null ? null : (paneByCell.value.get(paneUid.value) ?? null)));
   ```

2. `setRightPane(pane, uid)` が Map を書く。`openCanvasFor` は uid を明示して呼ぶ
   （`emit("toggle-expand")` の直後は `props.expandedUid` がまだ更新されていない）。

3. `paneUid` を一般化する:
   - 「files を離れるとき null にする」（`:240`）を **やめる** — ペインの identity になったので消さない。
     `paneCwd` / `paneState` のリセットは今のまま
   - 再ルート watcher（`:538`）を **files が開いているときだけ動く**から **どのペインでも動く**へ。
     files 固有の処理（flush / snapshot / reload）は、files が絡むときだけ実行する

4. リロード復元: `localStorage` に `Map<sessionId, RightPane>` を持つ。セルが初めて表示されたとき、
   メモリに無ければ sessionId で引く。files の cwd 別レイヤ（#958）と同じ発想。
   旧キー `files_pane_open` は**捨てる**（新規セルは閉じ、が決定なので移行先が無い）。

5. `gridCellProps` の `rightPane` / `filesOpen` を**そのセルの値**にする。
   各セルのヘッダのボタンが、自分の状態を示すようになる。

### テスト

- ズーム A→B でペイン種別が入れ替わる / A に戻ると A の状態
- **ズームを閉じて開き直してもペインが閉じない**（罠の回帰テスト。FilesPane が unmount しないこと）
- 初めてのセルは閉じている
- リロード相当（新しい uid + 同じ sessionId）で復元される
- files が dirty で flush 失敗のとき、ペインが前のセルに留まる
- 既存の canvas 自動オープン（ズーム中セルのみ）が壊れていないこと

## 関連

- #1237 — 単セルでズームが拒否され Canvas に到達できない（`openCanvasFor` を共有）
- #1374 / #1388 — present 系をエージェント抜きで開く
- #958 / #910 — files ペインの per-cell / 復元の前例
