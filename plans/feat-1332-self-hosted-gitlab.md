# feat #1332 — セルフホスト GitLab を config で宣言して使えるようにする

`gitlab.hogefuga.com` のような自前ホスティングの GitLab リポジトリを `prRepos` に入れると、
PRs / Issues のオーバーレイに

> `gitlab.hogefuga.com is not supported yet — MulmoTerminal reads github.com and gitlab.com`

とだけ出る。`glab` は入っていて認証も済んでいるのに到達しない。
#981 のクローズコメントどおり「**URL だけではセルフホスト GitLab を判別できないので、宣言する
設定が要る**」というのが理由で、その設定が無いまま今日まで来た。

この PR で足すのはその**宣言だけ**。設定画面は作らず、グローバル config
(`~/.mulmoterminal/config.json`) に手で書く形にする（UI は必要になったら後で）。

## 設定の形

```json
{
  "gitlabHosts": ["gitlab.hogefuga.com"],
  "prRepos": ["gitlab.hogefuga.com/group/project"]
}
```

- `gitlabHosts` は**ホスト名の配列**。ここに書いたホストは `gitlab.com` と完全に同じ扱いになる。
- `prRepos` 側の書き方は既存のまま (`host/owner/repo`)。`isRepoEntry` は既にこの形を通す。
- 反映は `getPrRepos()` と同じく**メモリ上の config**から。手で config.json を書いたらサーバ再起動
  （`prRepos` を手書きした場合も同じなので、挙動は既存と揃う）。
- GitHub Enterprise は対象外。必要になったら `githubHosts` を同じ形で足せる。

## いちばん大事な事実 — glab はホストを教えないと gitlab.com に行く

glab 1.111.0 で実測した（推測ではない）:

| 渡し方 | 実際に叩かれた先 |
| --- | --- |
| `--repo gitlab.nonexistent.invalid/group/project` | **gitlab.com** に `projects/gitlab.nonexistent.invalid%2Fgroup%2Fproject` として問い合わせ → 404 |
| `--repo https://gitlab.nonexistent.invalid/group/project` | `https://gitlab.nonexistent.invalid/api/v4/projects/group%2Fproject/...`（正しい） |
| `glab api --hostname <host> <path>` | `<host>`（`--hostname` が無ければ gitlab.com） |

つまり `--repo` に **`host/group/project` をそのまま渡すのは無言で別サーバに当たる**。
今のコードは `projectPath(forge)`（= ホストを落とした `group/project`）を `--repo` に渡しているので、
ホスト判定だけ直しても gitlab.com に問い合わせて 404 になる。

対策: glab に渡す値を**必ずホスト込みの https URL** にする。`gitlab.com` も同じ形に揃える
（分岐を増やさない。gitlab.com に対しても URL 形式が通ることは実 API で確認済み）。
`glab api`（issue notes）だけはパスを取るので `--hostname` を付ける。

## 変更点

### 1. 宣言の置き場所

- `common/gitlabHosts.ts`（新規）— `sanitizeGitlabHosts()` / `isGitlabHost()` / 未対応ホストの
  案内文。サーバとブラウザの**両方**が同じ答えを出す必要があるので `common/`。
- `server/config/app-config.ts` — `gitlabHosts: string[]` を AppConfig に追加
  （`emptyConfig` / `sanitizeAppConfig` / `mergeConfigUpdate` / `toPublicAppConfig`）。
- `server/config/config-body.ts` — `ARRAY_FIELDS` に追加（配列以外の POST で全消しされないため）。
- `server/config/config-routes.ts` — `getGitlabHosts()` と `setDeclaredGitlabHosts(getGitlabHosts)` の配線。
  配線は `mountConfigRoutes` の中ではなく**モジュールスコープ**で行う: forge の判定は git status の
  ポーリングやヘッダーの文脈でも走り、route を mount しない経路があるため。

### 2. ホスト判定

- `server/git/forge-host.ts` — `KNOWN_HOSTS` に無いホストでも、宣言済みなら `kind: "gitlab"`。
  宣言は**getter を注入**する（`setDeclaredGitlabHosts`）。`server/git` → `server/config` の
  import は既にある（worktree-pr → config-routes）が、逆向きに張ると循環するため、
  配線は config 側から行い、forge-host は config を import しない。デフォルトは `() => []`
  = 現状維持。

### 3. glab の呼び出しにホストを持たせる

- `server/git/glab.ts` — `GlabTarget { host, project, repo }` を導入し、引数ビルダは
  `project: string` ではなくこれを取る。`repo` は `https://<host>/<project>`、
  `project` は REST API のパス（`glab api` 用）。
- 呼び出し側（`prs.ts` / `issues.ts` / `issue-work.ts` / `prPhase.ts` / `work-comment.ts`）は
  `projectPath(forge) ?? forge.path` の代わりに `glabTarget(forge)` を使う。
- `worktree-pr.ts` は `--repo` を渡さず cwd から推論させているので変更なし（セルフホストでも
  worktree の remote から glab が解決する）。

### 4. メッセージ

未対応ホストの行は「なぜ弾かれたか」ではなく「**どうすれば通るか**」を出す:

> `gitlab.hogefuga.com is not supported yet — MulmoTerminal reads github.com and gitlab.com; if gitlab.hogefuga.com is a self-hosted GitLab, add it to "gitlabHosts" in ~/.mulmoterminal/config.json and restart`

同じ文を `forge-support.ts`（PRs/Issues の行）と `issueStartPlan`（開始ボタンの理由）で共有する。

### 5. work を始める側（ブラウザ / スマホ）

- `common/issueStartPlan.ts` — `STARTABLE_HOSTS` に宣言ホストを足す。
  `issueStartPlan(entry, repo, gitlabHosts)` と**引数を必須**にする（`repo` を必須にしたのと
  同じ理由: 渡し忘れるとセルフホストが黙って「未対応」に戻る）。
- `src/composables/useAppConfig.ts` に `gitlabHosts` を持たせ、`useIssueStart.planFor` から渡す。
- `server/backends/remoteHost/handlers/issueWork.ts` は `getGitlabHosts()` から渡す。

## テスト

- `sanitizeGitlabHosts` — 空/非文字列/重複/大文字/`https://` 付き/スラッシュ入りの落とし方。
- `forge-host` — 宣言ホストが `gitlab` になり、ネストしたグループが `projectPath` を通ること。
  宣言が無ければ `unknown` のままであること。
- `forge-support` — 宣言済みは supported、未宣言のエラー文が `gitlabHosts` を案内すること。
- `glab.ts` — `--repo` が https URL になること（gitlab.com も）、`api` に `--hostname` が付くこと。
  「ホスト込みのベア文字列を `--repo` に渡さない」ことを固定するテストを入れる（実測した罠）。
- `issueStartPlan` — 宣言ホストが startable、未宣言は `unsupported-forge`。
- `app-config` — config 往復（load → merge → toPublic）で `gitlabHosts` が残ること。

## ドキュメント

- README.md の config 表 / `glab` の行
- `docs/guide/{en,ja}/config.md`（キー一覧）、`docs/guide/{en,ja}/github.md`（手順:
  `glab auth login --hostname <host>` → `gitlabHosts` → `prRepos`）
- `server/skills/mulmoterminal-bug-report/faq.md`（#1332 の提案 2。ただし「未対応」ではなく
  「宣言すれば動く」に書き換える）

## やらないこと

- 設定画面（Settings UI）— ユーザの指示どおり後回し。
- GitHub Enterprise / Gitea など GitLab 以外の forge。
- ポート付きホスト (`gitlab.example.com:8443`) と http のみのインスタンス。
  `prRepos` のエントリ文字にコロンが使えない（`REPO_CHARS_RE`）ため、そもそも今の形では書けない。

## 実測での確認（自分の出力ではなく外部の ground truth）

セルフホストの GitLab は手元に無いので、**到達不能な `.invalid` ホスト**を宣言して
「glab が実際にどこへ dial したか」をエラー文から読んだ。DNS が引けないので通信は発生しない。

1. **argv 単体**（`glab` を直接実行）
   - `--repo <host>/<group>/<project>` → **gitlab.com** に問い合わせて 404（＝罠の確認）
   - `--repo https://<host>/<group>/<project>` → `https://<host>/api/v4/projects/group%2Fproject/...`
2. **アプリ経由**（`listPrsAcrossRepos` / `listIssuesAcrossRepos` / `fetchIssueDetail` /
   `glabIssueNotesArgs` / `glabMrForBranchArgs`）— すべて宣言ホストへ dial。ネストしたグループも
   `group%2Fsub%2Fproject` と1セグメントにエンコードされていた。
3. **実サーバ**（`HOME` を scratch に向けて `yarn server`、`config.json` は手書き）
   - `GET /api/config` に `gitlabHosts` が出る（ブラウザ側もここから読む）
   - `GET /api/prs` / `/api/issues`: 宣言ホストは dial、未宣言ホストは `gitlabHosts` を案内する行
   - `POST /api/config` で宣言を足すと**再起動なしで**次の `/api/prs` から反映
4. **gitlab.com の回帰**: `--repo` を URL 形式に統一しても実物の gitlab.com は従来どおり
   （`gitlab-org/cli` で MR 78件 / issue 20件 / issue view / notes すべて取得できた）
