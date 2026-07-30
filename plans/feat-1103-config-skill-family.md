# feat: 設定を対話で書く skill 群（#1103）

`mulmoterminal-config` 1 本（558 行 / 31,668 文字）を用途別に分割し、Settings に UI の無い設定
—— とりわけ**実際に使われているのに現 skill に載っていない** `themes` / global `buttons`・`chips`
/ `soundKinds`・`sounds` —— に対話で手が届くようにする。

## 何が問題だったか

1. 色を変えたいだけでも 31,668 文字が文脈に載る。
2. frontmatter の `description` が 1,590 文字の 1 段落で、「色」「keymap」「Enter キー」「CJK
   フォント」が同じ 1 文に詰まっている。どのトリガでも同じ 1 本しか出てこない。
3. `.mulmoterminal.json` を書く UI は存在しない（Settings の "Directory appearance" は
   `/mulmoterminal-config` を起動するボタン）。**スキルが唯一の書き込み経路**なのに穴がある。
4. 追従漏れが起きる。#1097 で `orderPriority` がランチャのチップも並べるようになり、README と
   日英ガイドは 2695a2fc で直ったが、**558 行のスキルだけ古い記述が残った**
   （"Only that one mode reads it"）。この PR で直す。

## 構成

```text
server/skills/
  mulmoterminal-config/    ルータ + audit（現状の読み出しと説明）
  mulmoterminal-dirs/      開いた dir 群の見た目と並び: 7 色 / theme / colors / fontSize
                           / name / orderPriority。palettes.json と生成スキーマはここ
  mulmoterminal-theme/     global の themes（自分の配色を作る）
  mulmoterminal-header/    buttons / chips（global + per-dir、マージ規則）
  mulmoterminal-keys/      keymap（send 含む）/ copyOnSelect / terminalSubmit
  mulmoterminal-model/     providers / per-dir の provider・model
  mulmoterminal-notify/    soundKinds / sounds（global + per-dir）/ pushKinds
```

`-theme` と `-grid` を分けない理由は #1103 のコメントに実測で書いた: 実配置では色と
`orderPriority` が**同じ系列判断から同時に**決まっていて、分けると同じ質問を 2 回することになる。

## `-dirs` の核心 — 母集団・一箇所・規則性

ユーザーの要求は 3 つ。

1. **母集団は `cwdPresets`**（実際に開いた dir）。`cwd` 1 個ではない。未設定の dir も候補に出す。
2. **一箇所で完結**。各ディレクトリでターミナルを開き直さない。
3. **既存の設定から規則性を読み取って継ぐ**。白紙のプリセットから始めない。

### 読み取りは `GET /api/dir-config-detail?cwd=<path>`

`server/routes/dir-routes.ts:107`。ファイルを自前で読むのではなくこれを使う理由:

- **アプリが実際にパースした結果**が返る（適用された値 / 検証で落ちたキー / 認識しないキー）。
  「設定したのに効かない」を説明できるのはこれだけ。
- 末尾スラッシュ・存在しない preset の扱いを既に正しく持っている
  （`existingWorkspaceFromQuery`。既定 workspace へフォールバック**しない**）。

書き込みは従来どおり Write/Edit で `.mulmoterminal.json` に。**書くこと自体がライブリロードの
合図**（ファイル監視は無い）。

### 規則性の推定（実測に基づく）

このマシンの 12 個の設定は完全に規則的だった。スキルはこれを**その場で実測して**組み立てる。

- **1 ディレクトリ = 1 色相**。7 つの色キーは全部その色相から、役割ごとに固定の S/L で導かれる。
- **リポジトリ系列 = 色相帯、クローン番号 = 帯の中のグラデーション**
  （mulmoterminal 系 238→187 で約 −13°/クローン、mulmoclaude 系 352→29 で約 +12°/クローン）。
- **`orderPriority` は 10 刻み、系列ごとにブロック**（20–60 / 70–100 / 120）。

観測から出す値は「S/L の中央値」「色相の刻み幅」「`orderPriority` の刻みと空き番」。
規則外（`mulmocast-cli`）と未設定（`mt-provider-trial`）は**勝手に直さず、指摘して聞く**。

### `headerTextColor` は推測しない

`src/components/contrast.ts` の `readableTextColor()` が WCAG 相対輝度で黒白を選ぶ。YIQ 近似は
色空間の 29.7% で誤る（#00ff00 が白字 1.37:1 になった実例つき）ため置き換えられた経緯がある。
スキルは同じ規則を明文で持ち、近似を使わない。

## description の書き分け

7 本が同じ語彙で自己紹介すると 1 本しか選ばれない。**症状で書き分ける**:

| skill | 引き受ける言い方 |
|---|---|
| `-dirs` | 色を変えたい / プロジェクトごとに色分け / グリッドの並び順 / 名前 / 文字が小さい |
| `-theme` | 自分の配色を作りたい / テーマを増やしたい |
| `-header` | ボタンを足したい / チップを消したい |
| `-keys` | ショートカット / Shift+Enter で送信される / 選択でコピー |
| `-model` | OpenRouter で動かしたい / このプロジェクトだけ別モデル |
| `-notify` | 音がうるさい / 終わったときだけ鳴らしたい |
| `-config` | 漠然とした入口 + 「今どうなってる？」 |

## 触るファイル

**新規**: 上記 6 ディレクトリの `SKILL.md`。`palettes.json` は `-config` → `-dirs` へ移動。

**改修**:

- `server/infra/install-bundled-skills.ts` — `BUNDLED_SKILL_NAMES`、`extrasFor()` の注入先を
  `mulmoterminal-dirs` へ（`dir-config.schema.json` は per-dir スキーマなので）
- `test/server/infra/install-bundled-skills.spec.ts` — `palettes.json` のパス
- `src/App.vue:227` / `src/components/SettingsModal.vue:497` — "Directory appearance" は `-dirs` を起動
- `bin/mulmoterminal.js:154` — 初回セットアップは**ルータのまま**（何をしたいか未定なので）
- `README.md` / `CLAUDE.md` / `docs/guide/{en,ja}/config.md`

## 非目標

- Settings に UI を足すこと
- 設定キーの追加・変更・改名
- 周辺設定（`addDirs` / `script.json` / `issueWorkComments` / `decisionDigest` /
  `prWorkdirFooter` / 環境変数）。#1103 で未決のまま
