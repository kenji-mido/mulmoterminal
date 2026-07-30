# refactor: SettingsModal の 17 セクションを 1 セクション 1 コンポーネントに分割 (#1126)

`src/components/SettingsModal.vue`（907 行 / script 410・template 495）を、`src/components/settings/`
配下の**セクション 1 つ = ファイル 1 つ**に分ける。あわせて、分割中に見えてきた重複 3 件を潰す。

issue の step 1（見出しクラスを `SECTION_HEADING` 定数にまとめる）は #1136 で完了済み。ここは step 2。

## なぜ 1 セクション 1 コンポーネントか

17 セクションは**互いに状態を共有していない**（それぞれ自分の composable か、自分の prop / emit 1 組
だけを見ている）。まとめる理由が「ファイル数を減らしたい」しかない一方、分けると:

- **skill ボタンとセクションの対応が 1 ファイルに収まる**。CLAUDE.md の「A skill with a Settings
  section is launched from it」は、controls とその `SkillLaunchButton` が同じファイルにある方が
  追える。#1097 は「1 つの巨大ファイルの中に散っている記述を 1 箇所見落とす」事故だった。
- **4 重複が見える場所に出る**。リスト編集 4 セクションが 4 ファイルになれば、同じ形をしていることが
  ファイル名の並びで分かる。900 行の中に埋まっている限り jscpd も規則も届かない（issue 参照）。

## 設計

### 1. 殻に残すもの

`SettingsModal.vue` は「モーダルの殻 + セクションを並べる + props/emits の転送」だけになる:

- overlay / dialog の div、ヘッダ（タイトル + 閉じるボタン）、フッタの Close
- Escape で閉じる / Tab を dialog 内に閉じ込める（`onKeydown` + `modalEl`）
- マウント直後の初期フォーカス

**props と emits の口は現状のまま変えない**。`SettingsModal.spec.ts` は `mount(SettingsModal)` に
props を直接渡して `w.emitted("update-...")` を見ているので、子で `useAppConfig()` を直読みする形
（AppSettingsModal がやっているような）に寄せると spec が全部壊れる。子は prop を受け、emit を親へ
転送する。

### 2. `src/components/settings/` に 17 ファイル

`src/components/` は 106 ファイルのフラットなディレクトリなので、17 ファイルを足すならサブ
ディレクトリを切る。spec 側は既に `test/src/components/` のようにパスを写しているので、新規 spec は
`test/src/components/settings/` に置く。

| ファイル | 状態の出どころ |
| --- | --- |
| `ThemeSection.vue` | `useTheme` |
| `TerminalFontSizeSection.vue` | `useTerminalFontSize` |
| `TerminalScrollSection.vue` | `useTerminalScrollSpeed` |
| `WaitingRowsSection.vue` | `useRosterAlert` |
| `DirAppearanceSection.vue` | prose + skill ボタンのみ |
| `DirSettingsSection.vue` | `dirPaths` prop |
| `NotificationSoundsSection.vue` | `soundFile` / `soundKinds` / `sounds` + 3 emit |
| `VoiceInputSection.vue` | `voiceLanguage` + capable probe |
| `WebPushSection.vue` | `pushEnabled` / `pushKinds` + 2 emit |
| `GoogleAccountSection.vue` | `useGoogleLink` |
| `PrReposSection.vue` | `prRepos` + emit |
| `LaunchersSection.vue` | `launchers` + emit |
| `QuickCommandsSection.vue` | `quickCommands` + emit |
| `McpServersSection.vue` | `userMcpServers` + emit |
| `CostSection.vue` | `useCost` + `cwd` / `sessionId` |
| `ShortcutsSection.vue` | `activeKeymap` |
| `HelpSection.vue` | `GuideLinks` |

### 3. セクションの root はフラグメントのまま

各セクションは `<h3>` + `<p>` + controls という**複数ルート**になる。Vue はフラグメント
コンポーネントの子を親へ直接描くので、モーダルの `flex-col` から見た DOM と flex アイテムの並びは
今と同一で、セクション間の余白（`h3` の `mt-3.5` / `p` の `mb-3`）もそのまま効く。

ラッパー div を足さないのは、足すと flex アイテムの数が変わって余白が崩れるから。そして
フラグメント root でも困らないのは、見た目が全部ユーティリティで、共有 CSS クラスに依存していない
ため（#787 でフラグメント root が scope id を受け取らないと分かって以来の方針 — `docs/styling.md`）。

`VoiceInputSection` だけは中身全体が `v-if="voiceCapable"`。描かないときはコメントアンカーだけが
残り、flex レイアウトには影響しない。

### 4. onMounted の分配

今は 3 つの初期フェッチが親の `onMounted` に集まっている。それぞれ自分のセクションへ移す:

- `refreshCost()` → `CostSection`（`cwd` / `sessionId` の watch も一緒に）
- `refreshGoogle()` + `disposeGoogle()` → `GoogleAccountSection`
- `refreshVoiceCapable()` → `VoiceInputSection`

モーダルは `v-if` で開閉されるので子も一緒にマウント/アンマウントされ、`useGoogleLink` の
ポーラー停止（`dispose`）のタイミングは変わらない。

## 分割にあわせて潰す重複

いずれも issue には書かれていないが、分割すると 4 ファイルに散る形で残ってしまうので同じ PR で扱う。

### a. `SettingsListRow.vue` — 削除ボタン付きの行（4 箇所）

PR repos / Launch commands / Phone quick commands / MCP servers が、`<li>` の枠 6 ユーティリティと
**同一の close ボタン 8 行**を 4 回書いている。`name` から `Remove ${name}` の `title` /
`aria-label` を作り、行の中身は slot。

`<ul>` 側の `m-0 mb-2 flex list-none flex-col gap-1 p-0` も 4 回なので、`SETTINGS_LIST` という
class 文字列定数にする（`v-if` の条件が各セクションで違うので `<ul>` 自体はセクションに残す）。

なお、同じ close ボタンの並びは**モーダルのヘッダにもある**（合計 5 箇所）。4 箇所が
`SettingsListRow` に吸収されればヘッダの 1 箇所だけが残るので、そこは触らない。`TerminalCell.vue`
にも `--err-hover-bg` を使うボタンがあるが、ユーティリティの並びは別物なので対象外。

### b. `SettingsStepper.vue` — −/値/+（2 箇所）

Terminal font size と Terminal scroll speed の 25 行がほぼ同一。`value` / `unit` / `min` / `max` /
`step` / `label` を受け、`@nudge` で符号付きの step を返す。`aria-label` は
`Decrease ${label}` / `Increase ${label}` で現状の文言（"Decrease terminal font size" など）に一致。

値の表示は `{{ value }}{{ unit }}` で、`px` は前に空白あり・`×` は空白なしという**今の表示を変えない**
ため `unit` は `:unit="' px'"` のようにバインドで渡す（静的属性の先頭空白は読み手に消される）。

分割前は属性が多くて prettier が改行していたため、ボタンの中身が `> − <`（グリフの両側に空白）で
描画されていた。共有コンポーネントでは 1 行に収まるので prettier が `>−<` に畳む。**これが唯一
残った描画差**（下記）。

### c. `useSavedListMirror` — 編集ミラーの script（4 箇所）

「保存値を watch してローカル ref に写す + 新リストを emit する」が 4 本ある。`items` と `replace`
だけを持つ composable にし、**`add` / `remove` は各セクションに残す**（フィールド数と検証が 4 つで
違う。`settingsValidators.ts` はそのまま使う）。

ローカルコピーであることが仕様: 最初の POST が返る前に 2 回目の編集をすると、両方が保存前の同じ
スナップショットから計算されて 2 回目が 1 回目を取り消す。この理由のコメントは composable 側へ移す。

内部は `ref<T[]>` ではなく `shallowRef<T[]>`。`ref` はジェネリックだと `UnwrapRef` を噛ませるので
`as Ref<T[]>` が必要になり、CLAUDE.md の `as` 禁止に触れる。リストは常に丸ごと差し替える使い方
なので `shallowRef` が意味的にも正しい。

## テスト

`SettingsModal.spec.ts`（369 行）は `mount` からツリー全体を `find` / `findAllComponents` している
ので、子に切り出しても**emit を親まで転送すれば**セレクタは無改変で通る。ここを緑のまま保つのが
この refactor の合否条件。`AppSettingsModal.spec.ts` と `GridView.spec.ts` は SettingsModal を
スタブしているので影響なし。

新規に追加するもの:

- `useSavedListMirror` — 保存値の反映、丸ごと差し替え、保存前の 2 連続編集
- `SettingsStepper` — min / max での disabled、`@nudge` の符号、`aria-label` の文言
- `SettingsListRow` — `@remove` と `Remove ${name}` の `title` / `aria-label`

## 検証

`yarn format` → `yarn lint` → `yarn typecheck` → `yarn typecheck:server` → `yarn typecheck:test` →
`yarn build` → `yarn test`。

### DOM が変わっていないことは spec では足りない

「spec が緑」は「見た目が同じ」ではない。分割前のコンポーネントを `SettingsModalBeforeSplit.vue`
として一時的に併置し、**同じ props で両方を mount して `html()` を直接 diff** した（使い捨て、
コミットしない）。条件を振ったのは 9 通り: 全リスト有り / 全て未設定 / push off / cwd と session
無し（グリッド） / 存在しない theme / 文字起こし不可 / Google が使えない / Google 連携済み /
cost 取得失敗。

43KB の描画結果のうち、**構造差はゼロ**。生の差分は whitespace だけで、全量は次の 2 種類:

1. ステッパーボタンの内側 `> − <` → `>−<`（4 箇所 = 2 ボタン × 2 セクション）
2. Notification sounds の **HTML コメント**のインデント（6 箇所）。コメントは描画されないので無害

### 1 の扱い（PR で human に見てもらう項目）

`w-8 h-8` の flex ボックスに `items-center justify-center` が掛かっているので、テキストは匿名
flex アイテムになり、その両端の空白は CSS が落とす — つまり見た目は変わらない、が **これは仕様の
読みであって実測ではない**。Playwright は未導入で、同じ形（フレックス中央寄せの固定サイズ箱に
裸のテキスト 1 文字）のボタンはリポジトリ内に他に無いため、出荷済みの UI からも裏が取れない。
依存を足さずに済ませ、PR の「要確認」に挙げて実機で 1 度見てもらう。

ソース側で ` − ` を復元する案は捨てた: prettier は 160 桁に収まると畳み直すので、`{{ " − " }}`
のような構造にしないと保てず、それを正当化するコメントは「実は無害」と矛盾する。
