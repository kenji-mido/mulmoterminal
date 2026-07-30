# feat: 無設定で OS 標準シェルを開く — 空セルの選択行に Shell を足す

Issue: #1114

## 何が起きていたか

「terminal のセルを開く方法がわからず、しばらく右往左往した。Settings → Launch Command から
設定したら、空のセルの画面の一番下に現れた」

空セルの launch form が上段に並べているのは Claude / Codex / Antigravity の 3 つで、素のシェルは
**自分で launch command を登録して初めて**、画面最下部の OR LAUNCH に現れる。初回起動でユーザーが
最初に見る画面から、設定なしでは素のシェルが開けない。

## 調査 — 足りないのは入口だけだった

シェルを起動する仕組みは、サーバ側もセル側も**すでに揃っている**。

| 場所 | 既にあるもの |
|---|---|
| `server/routes/ws-routes.ts` | `DEFAULT_LAUNCH_CMD = process.env.SHELL \|\| "/bin/sh"`。`/ws/launch?shell=true` は launcher の index を要らない |
| `common/launchAgent.ts` | `LAUNCH_AGENTS = ["shell", "claude", "codex", "antigravity"]` — shell を claude/codex と**同列の起動対象**として定義済み（スマホからの起動 #831 が使う） |
| `common/sessionAgent.ts` | `TERMINAL_AGENTS`（= claude/codex/antigravity）と、shell を含む `SESSION_AGENTS` |
| `src/components/gridTabs.ts` | `CellLauncher` の `{ shell: true }` と `shellCell` — 設定 index を持たない永続シェルセル |

`{ shell: true }` のシェルセルは、キーボードショートカット（`terminal-new-adjacent`）・走っている
セルのヘッダの「New terminal here」・スマホからの起動では開ける。**開けないのは空セルの画面だけ。**

## 決めたこと（ユーザ確認済み）

| 論点 | 決定 |
|---|---|
| 置き場所 | 空セル上段の選択行を `Claude \| Codex \| Antigravity \| Shell` にする |
| 起動 | Shell を選ぶと、既存の「Working directory + ▶」がそのディレクトリで `$SHELL` を起動する（永続 launcher セル = `{ shell: true }`） |
| Shell 選択時に隠す欄 | model picker / MCP トグル / OR ISOLATE IN A WORKTREE |
| 隠さない欄 | dir チップ・scripts・OR LAUNCH・OR RESUME HERE（選択行とは別の操作） |
| 選択行の並び | エージェント（Claude 先頭 = 既定）→ Shell 末尾。`TERMINAL_AGENTS` から引き、UI 側に第二のリストを作らない |
| 既定の選択 | Claude のまま（変えない） |

却下した案:

- **OR LAUNCH に組み込みの Shell を常時表示** — 変更は最小だが、今回「右往左往」した画面最下部の
  ままで、見つけにくさが残る。
- **dir 入力欄の隣に shell ボタンを足す** — 最小差分だが、▶ との違いがアイコンと tooltip だけになる。

## 実装

### 1. 選択肢のリスト（新規 `src/components/launchTargets.ts`）

`TERMINAL_AGENTS` の後ろに `"shell"` を付けた表示順 + ラベル。ラベルは `Record<LaunchAgent, …>`
なので、`LAUNCH_AGENTS` に起動対象が増えたらラベル無しではコンパイルが通らない。spec で
「並びの集合 == `LAUNCH_AGENTS` の集合」を押さえ、片方だけ増えた状態を落とす。

### 2. セルの状態（`src/components/TerminalCell.vue`）

`agent` ref（`TerminalAgent`）を**選択行の状態から外す**。

```ts
const launchTarget = ref<LaunchAgent>(asTerminalAgent(props.initialAgent)); // 選択行が持つ
const agent = computed<TerminalAgent>(() => asTerminalAgent(launchTarget.value)); // shell → claude
```

`agent` は「走るセッションの身元」で、shell は launcher なのでそこには入らない。二つの ref に
同じユーザーの選択を持たせると片方だけ更新されて壊れるので、選択は 1 本にして `agent` は派生に
する。

### 3. 起動経路を 1 箇所にまとめる

「選択行が起動対象を決める」は、この form の**すべての起動口**で成り立たなければならない。
今 `launchIn()` を呼んでいるのは dir 欄の ▶ / Enter・dir チップの ▶・worktree の作成/再利用。
共有ヘルパ `startTarget(dir)` を通し、shell なら `launch` emit（親がセルを launcher セルに
差し替える）、それ以外は従来の `launchIn(dir)`。

### 4. `LaunchPick` を launcher そのものにする

`{ index, label, cwd }` は「設定リストの位置」しか表せない。`CellLauncher`（`{ index, label }`
| `{ shell: true, label }`）をそのまま載せる形に変える。

```ts
export interface LaunchPick { launcher: CellLauncher; cwd: string | null }
```

`GridView.onLaunch` は `launchInCell(state, uid, pick.launcher, pick.cwd)` になり、shell/index の
分岐が UI からも grid からも消える。シェルセルのラベルは `SHELL_LAUNCHER_LABEL`（`shellCell` と
共有）なので、ヘッダのボタンで開いたシェルと同じ名前でグリッドに並ぶ。

## テスト

- `launchTargets.spec.ts` — 並び（agents → shell）、集合が `LAUNCH_AGENTS` と一致、全対象にラベル
- `TerminalCell.spec.ts`
  - 選択行に 4 つ出る / 既定は Claude
  - Shell + dir 欄 ▶ → `launch` emit が `{ shell: true, label: "shell" }`、Claude セッションは張らない
  - Shell + **dir チップの ▶** → 同じ（起動口を変えても規則が保たれる）
  - Shell 選択で model picker / MCP トグル / worktree が消え、Claude に戻すと戻る
  - Claude のままなら従来どおり（`launch` emit なし）
- `GridView.spec.ts` — shell の `LaunchPick` でセルが `{ shell: true }` の launcher セルになる

## ドキュメント

- README: launch form の説明（「toggle Claude / Codex」「OR LAUNCH starts a plain shell」）を、
  選択行に Shell がある形へ。
- `docs/guide/{en,ja}` の該当ページも同じ内容に合わせる。
