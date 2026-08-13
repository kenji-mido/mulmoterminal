# fix(build): `yarn typecheck` を1本にして repo 全体を見せる (#1312)

## 何が壊れていたか

root の `tsconfig.json` が **app と node しか参照していなかった**。`yarn typecheck` は
`vue-tsc -b`、つまりこの solution file を build するだけなので、**`server/**` と `test/**` は
最初から視界に入っていなかった**。

CLAUDE.md に書いてあった「**`yarn typecheck` alone passes while CI fails**」「3つ全部走らせろ」
は、この欠落を運用でカバーするための注意書きだった。

## 実証（passed を信用しない）

「5つ参照して clean だった」は「5つとも検査している」の証拠にならないので、**4領域それぞれに
`const x: number = "nope"` を仕込んで、検出されることを確認した**。

| 仕込んだ場所 | 検出 |
|---|---|
| `server/config/workspace.ts` | ✓ |
| `src/utils/focusTrap.ts` | ✓ |
| `test/common/readString.spec.ts` | ✓ |
| `test/server/git/prs.spec.ts` | ✓ |

修正前の root tsconfig で同じ server のエラーを測ると **0 errors**（完全に素通り）。

## `composite` について

どの project にも `composite` は設定されていない（`tsc --showConfig` で確認、全部 `null`）。
そのため「参照される project は全ファイルを include に列挙しなければならない」という
composite の制約には当たらず、spec 用 project が src / server を include せず import だけで
使っている現状のままで参照できる。

## 速度

1本にまとめた方が**速い**。`-b` が project 間で作業を共有するため。

| | cold |
|---|---|
| 新: `yarn typecheck` 1本（5 refs） | **13.3s** |
| 旧: `typecheck` + `typecheck:server` + `typecheck:test` | 14.1s |

（参考: 旧 `yarn typecheck` 単体は 3.5s だったが、それは server と test を見ていなかったから。）

`build` / `prepack` も `vue-tsc -b` を通るので、spec の型エラーで build が落ちるようになる。
CI では Typecheck ステップの後なので `-b` が warm でほぼ無コスト。publish 時（`prepack`）だけ
cold を払うが、spec が型エラーの状態で publish が止まるのは望ましい方向と判断した。

## 変更

- `tsconfig.json` — `references` に `server` / `test` / `test-server` を追加（2 → 5）
- `package.json` — 冗長になった `typecheck:server` / `typecheck:test` を削除
- `.github/workflows/ci.yml` — typecheck 3ステップ → 1ステップ
- `.github/workflows/windows-daily.yaml` — typecheck 2ステップ → 1ステップ
- `.github/workflows/codex_review.yaml` — 「three typechecks」の記述を修正
- `CLAUDE.md` / `README.md` — 「3つ走らせろ」を削除し、**project を足したら root の
  `references` にも足す**という新しい注意書きに置き換え

`plans/` の過去の記録に残る `typecheck:server` の記述は、当時の事実なので触っていない。
