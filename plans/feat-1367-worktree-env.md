# feat #1367 — worktree ごとにポートと slug を配る（`worktreeEnv`）

## 背景

worktree のファイルは隔離されているが **ポートは隔離されていない**。worktree A で `yarn dev`、
worktree B でも `yarn dev` をやると同じ 3000 を取りに行って落ちる。DB 名も同じで、5体が同じ
ローカル DB を見ていれば migration を走らせた1体が残りを壊す。

worktree の作成コストは #1219 でほぼゼロになったので、次に残っているのがこれ。

## 決めたこと

- スコープは **port + slug + ヘッダ表示**（issue の提案どおり）。DB そのものは触らず、
  一意な名前（slug）を env で渡すところまで。
- 対象は **managed worktree だけでなく全ディレクトリ**。同じリポの clone が並んで走っている
  （このマシンには `mulmoterminal2`〜`6` がある）ので、メインの checkout 同士も衝突する。
- 割り当ては **レジストリに永続化**。ハッシュだけで決めない。

### なぜ「毎回 空きポートを実測する」ではダメか

issue の提案 3 番目「実際に空いているか確認してから渡す（衝突したら次を試す）」を
**spawn のたびに** やると壊れる。worktree A の dev サーバが 3010 を掴んでいる状態でセルを開き直すと
「3010 は使用中」→ 3011 にずれる。**自分自身から逃げる**。

さらに tmux 再アタッチでは env が再評価されない（`ptyWouldReattach`）ので、値は
「同じディレクトリなら常に同じ」でなければならない。

→ **実測は割り当て時（初回）だけ**。以後はレジストリから引く。

### なぜハッシュではなく順番か

レジストリで固定するなら、初回候補をハッシュにする理由がない。順番に配ったほうが
番号が小さく読みやすく、issue の例（`fix-login → 3010`, `add-search → 3020`）そのものになる。

## 割り当ての規則

`.mulmoterminal.json`:

```jsonc
{
  "worktreeEnv": {
    "PORT": { "kind": "port", "base": 3000 },
    "API_PORT": { "kind": "port", "base": 4000 },
    "DB_NAME": { "kind": "slug", "prefix": "myapp_" }
  }
}
```

- `kind: "port"` — `base + slot * 10`。slot は 0 から順に空きを探す。
  - **stride は 10。** vite をはじめ多くの dev サーバは自分のポートが埋まっていると
    `port + 1` に勝手にずれる。1 刻みだと、その「ずれた先」が隣の worktree の枠に着地する。
  - **managed worktree は slot 1 から探す。** slot 0（= base そのもの）はプロジェクト本体の
    checkout に残す。これで「メインは 3000、worktree は 3010, 3020」という素直な絵になる。
    （なお slot 0 を取れるのは最初に予約した1つだけ。同じ base を宣言した 2 つ目の clone は
    次の空きに回る — clone 同士の衝突も塞ぎたいので、これが狙いどおり。）
- `kind: "slug"` — `prefix` + ディレクトリの識別子（worktree なら task 名、そうでなければ
  basename）を `[a-z0-9_]` に潰したもの。衝突したら `_2`, `_3`。63 文字で切る（Postgres の
  識別子上限）。

「取られている」の判定は 2 つ:

1. レジストリに載っている値（**ただしディレクトリがもう無いエントリは空きとして扱う**）
2. 実際に bind できるか（`net.createServer().listen(port, "127.0.0.1")`）— **割り当て時のみ**

## レジストリ

`~/.mulmoterminal/worktree-env.jsonl` に **追記のみ**（`session-tool-groups.ts` と同じ理由）。
`MULMOTERMINAL_HOME` は同じマシンの全サーバで共有なので、read-merge-write だと
先に書いたインスタンスの予約が消える → 消えた予約のポートが別ディレクトリに再配布される。

1 行 = 1 予約 `{"dir":"…","name":"PORT","base":3000,"value":"3010"}`、
解放は `{"dir":"…","release":true}`。同じ `(dir, name)` は後勝ち。

- `base` を記録するのは、config の `base` を書き換えたときに再割り当てさせるため。
- worktree を閉じたら（`removeWorktree`）解放行を追記する。
- 2つのサーバが同時に初回割り当てをすると同じ値を掴みうる（`readLog` → 選ぶ → `appendLog` の窓）。
  lock は入れず、**後から負けを判定して retry** する: ログは追記のみで両プロセスが同じバイト列を
  読むので、**先に載っているほうが勝ち**という判定は両者で一致する。負けたほうが解放して取り直す。
  → 衝突は起きうるが **残らない**（stale lock の掃除も要らない）。

## 実装

### 割り当てのタイミング（spawn は同期、割り当ては非同期）

spawner（`spawnClaudePty` / `spawnLauncherPty` / …）は同期関数で、`ptySpawn` の `env` に
同期で値を積む必要がある。一方 実測 probe は非同期。そこで:

- `ensureWorktreeEnv(cwd)` — **唯一の割り当て器**（非同期・probe・追記）。ws ハンドラ 5 本
  （claude / codex / antigravity / launch / run）が cwd を解決した直後に await する。
  `createWorktree` からも呼ぶ。
- `reservedWorktreeEnv(cwd)` — レジストリの**同期読みだけ**。割り当てはしない。spawner が使う。

割り当ての規則はこの 1 か所にしか無いので、2 経路で答えが食い違うことはない。
`worktreeEnv` 未宣言のディレクトリでは両方とも即 `{}` を返す（レジストリすら触らない）。

### ファイル

- `common/worktreeEnv.ts` — 純粋な部分（wire 型 `WorktreeEnvValue`、stride、slot→port、
  slug 生成、`localUrlForPort`）
- `server/config/config-schema.ts` — `worktreeEnvSchema` / `dirWorktreeEnvField` /
  `writableDirConfigSchema` に追加（skill 同梱の JSON Schema もここから生成される）
- `server/config/dir-config.ts` — `DirConfig.worktreeEnv` を読む
- `common/dirConfigSource.ts` — `DIR_CONFIG_KEYS` に追加（Settings のプレビューが
  「unknown」と言わないように）
- `server/config/worktree-env.ts` — レジストリ + `ensureWorktreeEnv` / `reservedWorktreeEnv`
- `server/config/worktree-dir-config.ts` — `INHERITED_KEYS` に `worktreeEnv` を足して
  worktree に引き継ぐ
- `server/session/spawn-{claude,codex,antigravity,shell}.ts` — `ptySpawn` の env に混ぜる
- `server/routes/ws-routes.ts` — 5 ハンドラで `await ensureWorktreeEnv(cwd)`
- `server/git/worktrees.ts` — `createWorktree` で予約、`removeWorktree` で解放
- `server/routes/dir-routes.ts` — `/api/header` の応答に `env` を載せる
- `src/composables/useHeaderButtons.ts` / `src/components/WorktreeEnvChip.vue` /
  `TerminalCell.vue` — `:3010` チップ。port はクリックで `http://localhost:3010` を開く

### ドキュメント

- README の worktree 節（issue が引用している「A shell or a `yarn dev` launcher stays free」）
- `docs/guide/{en,ja}` の該当ページ
- skill は `mulmoterminal-dirs`（`.mulmoterminal.json` のプロジェクト設定を持っている skill）

## やらないこと

- DB そのものの作成 / migration。slug を渡すところまで。
- `worktreeEnv` を宣言していないプロジェクトでの挙動変更（完全に現状維持）。
- 既に走っている dev サーバの番号を後から動かすこと（レジストリで固定なので起きない）。
