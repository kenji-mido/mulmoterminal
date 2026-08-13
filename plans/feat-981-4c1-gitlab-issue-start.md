# feat(#1257 / #981 段階4c-1): GitLab の issue から着手できるようにする

段階4a で一覧は読めるようになったが、行の ▶ は「github.com only」のままだった。その入口
（issue 本文の読み取り）を GitLab 対応にする。**GitHub の挙動は変えない。**

## 実物で確認したこと

glab 1.111.0 をテストプロジェクトに対して実行して分かったもの。**記憶で書くと踏む。**

| コマンド | 出力形式のフラグ |
| --- | --- |
| `mr list` | `-F` |
| `issue list` | **`-O`**（`-F` は details/ids/urls） |
| `issue view` | **`-F`**（`-O` は「Unknown shorthand flag」で即エラー） |

フィールド: `number` → **`iid`**、`body` → **`description`**。

## 途中で見つかった穴（実機で通して初めて出た）

**1. GitLab のクローンが `/api/repo-dirs` に載らない。** `repoForDir` は GitHub 以外に
`repo: null` を返していた（段階2b の時点では GitHub しか着手できなかったので正しかった）。
これを直さないと、ゲートを広げてもボタンは無効のまま。

**2. ホストを剥がすと forge が分からなくなる。** ルートが `canonicalRepo` してから
`startIssueWork` に渡していたので、`isamu1/node-test` が「ホスト無し＝GitHub」と解釈され、
存在しない GitHub リポを見に行っていた。

## 2つの識別子を分ける

1 と 2 の根っこは同じで、**1つの文字列に2つの役割を持たせていた**こと。分けた。

| | 何に使うか | ホスト |
| --- | --- | --- |
| `repoIdentity` | 設定エントリと解決済みクローンの**照合** | **付ける**（`github.com/a/b` と `gitlab.com/a/b` を潰さないため） |
| `canonicalRepo` | CLI の `--repo` に渡す | **剥がす**（ホストはそのホスト自身が知っている） |

ホスト付きのまま持ち回り、**CLI の直前でだけ剥がす**。

## 検証

- `fetchIssueDetail` を実 GitLab issue と実 GitHub issue の両方で実行し、正しく読めることを確認
- `repoForDir` が GitLab クローンを `gitlab.com/isamu1/node-test` として返すことを確認
- `/api/repo-dirs` がそれを載せることを確認
- `POST /api/issues/start` が検証を通り、クローンと照合し、issue 読み取りまで到達することを確認

**worktree 作成と spawn まではサンドボックスで未確認。** demo 用の `HOME` に差し替えると glab が
認証情報を見つけられず（keychain のトークンは glab が内部でリフレッシュしていて取り出せない）、
`MULMOTERMINAL_HOME` は `os.homedir()` 由来で上書きできないため。その先のコードは forge 非依存で、
GitHub 経路で実証済み。
