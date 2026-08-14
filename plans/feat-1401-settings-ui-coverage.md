# feat(settings): JSON 手書きでしか設定できないキーを設定UIと skill から触れるようにする (#1401)

## 背景

`~/.mulmoterminal/config.json` のグローバル設定は 27 キーあるが、棚卸しの結果、**設定UIからは触れないキーが
12 個、どの skill も設定方法を持たないキーが 9 個**あった。guide には全キー載っている（リファレンス表に 2 つ漏れ）
が、「guide を読んで JSON を手書きする」以外の道が無い設定が残っている。

`issueWorkComments` を有効にするのに config.json を直接編集する必要があった、というのがきっかけ。

## 棚卸し結果（グローバル設定 27 キー）

調査日 2026-08-04。`server/config/app-config.ts` の `AppConfig` を基準に、設定UI（`src/components/settings/`）・
skill（`server/skills/`）・guide（`docs/guide/{en,ja}/config.md` の本文セクションと「Every key」表）を突き合わせた。

| キー | 設定UI | skill | guide本文 | 全キー表 |
|---|---|---|---|---|
| `issueWorkComments` | ✗ | ✗ | ✓ | ✗ |
| `decisionDigest` | ✗ | ✗ | ✓ | ✓ |
| `cockpitLines` | ✗ | ✗ | ✓ | ✓ |
| `worklogEnabled` / `worklogIntervalHours` | ✗ | ✗ | ✓ | ✓ |
| `prWorkdirFooter` | ✗ | ✗（`appendSystemPrompt` の項で言及のみ） | ✓ | ✓ |
| `repoDirs` | ✓（issue 着手時のクローン選択） | ✗ | ✓ | ✓ |
| `launchers` | ✓ | ✗ | ✓ | ✓ |
| `quickCommands` | ✓ | ✗ | ✓ | ✓ |
| `userMcpServers` | ✓ | ✗ | ✓ | ✗ |
| `gitlabHosts` | ✗ | ✓ config | ✓ | ✓ |
| `appendSystemPrompt` | ✗ | ✓ config | ✓ | ✓ |
| `terminalSubmit` | ✗ | ✓ keys | ✓ | ✓ |
| `copyOnSelect` | ✗ | ✓ keys | ✓ | ✓ |
| `fontFamily` | ✗ | ✓ dirs | ✓ | ✓ |
| `providers` | ✗ | ✓ model | ✓ | ✓ |
| `buttons` / `chips` | ✗ | ✓ header | ✓ | ✓ |
| `keymap` | 読み取り専用 | ✓ keys | ✓ | ✓ |
| `themes` | 選択のみ（定義は skill） | ✓ theme | ✓ | ✓ |
| `cwdPresets` | ✓（ランチャのチップ） | ✓ config / dirs | ✓ | ✓ |
| `soundFile` / `soundKinds` / `sounds` | ✓ | ✓ notify | ✓ | ✓ |
| `pushEnabled` / `pushKinds` | ✓ | ✓ notify | ✓ | ✓ |
| `prRepos` | ✓ | ✓ config | ✓ | ✓ |

per-project の `.mulmoterminal.json`（15 キー）は全キーが UI 非対応だが、これは「skill が書く / UI は書かない」と
CLAUDE.md に明記された設計上の意図なので今回の対象外。

## 前提（調査で分かった、実装に効く事実）

- **サーバ側の変更は要らない。** `toPublicAppConfig()` は 27 キー全部を `GET /api/config` で返しており、
  `mergeConfigUpdate()` も 27 キー全部の部分更新を受け付ける。足りないのはクライアントと skill と docs だけ。
- **クライアントが値を保持していない設定がある。** `prWorkdirFooter` / `appendSystemPrompt` / `decisionDigest` /
  `worklogEnabled` / `worklogIntervalHours` はペイロードには載っているが、どこにも読み込んでいない。
- **描画できない形で保持している設定がある。** `copyOnSelect.ts` / `issueWorkComments.ts` / `terminalSubmitMode.ts`
  は「何も描画しないから」という理由でプレーンなモジュール変数（`let`）。設定UIが描画するようになると
  この前提が崩れるので、`cockpitLines.ts` / `terminalFontFamily.ts` と同じ ref + getter に揃える。
- **新しいセクションは props/emit を通さない。** `SettingsModal.vue` の props/emit は「シェルと spec が
  このコンポーネントを名指しするから」残っている配線で、`ThemeSection` / `WaitingRowsSection` のように
  自分の composable を直接読むのが現行の作法。シングルトン ref なので同じ状態が見える。

## 実装

### 1. 共有ヘルパの切り出し

- `src/composables/postConfigField.ts` — `useAppConfig.ts` にあった private な `postConfigField` を移す。
  各設定モジュールが自分の saver を自分の隣に持てるようにするため。

### 2. 設定モジュール側（ref 化 + saver）

| モジュール | 変更 |
|---|---|
| `copyOnSelect.ts` | `let` → ref。`isCopyOnSelectEnabled()` は維持、`copyOnSelect` ComputedRef と `saveCopyOnSelect()` を追加 |
| `issueWorkComments.ts` | 同上（`issueWorkComments` / `saveIssueWorkComments`） |
| `terminalSubmitMode.ts` | 同上（`terminalSubmitMode` / `saveTerminalSubmitMode`） |
| `cockpitLines.ts` | 既に ref。`saveCockpitLines()` を追加 |
| `terminalFontFamily.ts` | 既に ref。`saveGlobalFontFamily()` を追加 |
| `globalToggles.ts`（新規） | クライアントが持っていなかった 5 つ（`prWorkdirFooter` / `appendSystemPrompt` / `decisionDigest` / `worklogEnabled` / `worklogIntervalHours`）の ref・`adoptGlobalToggles()`・saver |
| `useAppConfig.ts` | `applyGlobalSettings()` から `adoptGlobalToggles(c)` を呼ぶ。`saveGitlabHosts()` を追加 |

既定値は `server/config/app-config.ts` の `DEFAULT_APP_CONFIG` に合わせる
（`prWorkdirFooter` / `appendSystemPrompt` は true、他は false / 6 時間）。

### 3. 設定UI（意味ごとに配置）

| セクション | キー | 種別 |
|---|---|---|
| Terminal font family（新規、font size の直後） | `fontFamily` | テキスト入力。**サーバ再起動が要る**旨を明記 |
| Waiting rows（既存を拡張） | `cockpitLines` | title / summary / tail の 3 ステッパー |
| Shortcuts（既存を拡張） | `copyOnSelect` / `terminalSubmit` | チェックボックス / ラジオ |
| GitHub（新規） | `issueWorkComments` / `prWorkdirFooter` / `gitlabHosts` | チェックボックス 2 + ホスト一覧 |
| Session（新規） | `appendSystemPrompt` / `decisionDigest` / `worklogEnabled` + `worklogIntervalHours` | チェックボックス 3 + ステッパー |
| Header buttons & chips（新規） | `buttons` / `chips` | 読み取り専用サマリ + `mulmoterminal-header` 起動ボタン |
| Models & backends（新規） | `providers` | 読み取り専用サマリ + `mulmoterminal-model` 起動ボタン |

`buttons` / `chips` / `providers` は構造が複雑（配列 of オブジェクト、`when` スコープ、`tokenEnv`）なので、
現在値の確認は UI で・編集は skill で、という `ShortcutsSection` と同じ流儀にする。CLAUDE.md の
「Settings セクションを持つ skill はそこから起動する」に従い、`-header` と `-model` にボタンができる。

各コントロールには **いつ効くか**（即時 / タブ再読み込み / サーバ再起動）と guide へのリンクを添える。

### 4. skill（`mulmoterminal-config`）

既存の「Three settings that live here」（`skills` / `appendSystemPrompt` / `gitlabHosts`）に、
所有 skill が無い 5 キーを追加する: `issueWorkComments` / `prWorkdirFooter` / `decisionDigest` /
`cockpitLines` / `worklogEnabled` + `worklogIntervalHours`。

router を目次に留める方針は保つ（独立 skill にするほどでない設定の置き場、という既存の役割の延長）。
「Where settings live」表の「Most of it has no UI」も、UI が増えるので書き換える。

### 5. guide

- `docs/guide/{en,ja}/config.md` の「Every key」表に `issueWorkComments` と `userMcpServers` を追加。
- 「Settings modal」節に新セクションを反映。
- UI から設定できるようになったキーは、各本文セクションに「Settings からも変えられる」旨を追記。

### 6. テスト

- 新セクションのマウント + トグルが `POST /api/config` を正しいフィールドで呼ぶこと。
- ref 化した 3 モジュールの getter が従来どおり働くこと（既存の呼び出し側の回帰）。
- `AppConfig` のキーと「設定UI か skill のどちらかに出てくること」を突き合わせる棚卸しテストを置き、
  次に設定を足したときに同じ抜けが再発しないようにする。
