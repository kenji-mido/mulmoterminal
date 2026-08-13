# refactor #1166 — xterm / WebSocket のテストダブルを共有し、spec を分割する

## 症状

`test/src/composables/useTerminalConnections.spec.ts` が **1020 行**（issue 起票時は 789 行）。
eslint の `max-lines`（上限 600）を超えて warning を出し続けている。

このリポジトリの慣習は「既に上限を超えているファイルには足さず、新しい spec ファイルにする」で、
`terminalCellMissedMark.spec.ts` の冒頭コメントがそれを明文化している。

## なぜ守れていなかったか

冒頭に **約 150 行の足場**がある。

- `vi.hoisted` の `mockTermState` / `mockKeyState`
- `@xterm/xterm` の `Terminal` ダブル（20 メソッド超）
- `@xterm/addon-*` 3 種のダブル
- 手動で駆動する `FakeWebSocket`

新しい spec に分けるとこれを丸ごと複製することになり、`max-lines` の warning 1 件を消すために
DRY を破る。#1165 でもこれが理由で分割を見送り、746 → 789 行に増やしている。

## 先に実証したこと（設計がこれに全依存するため）

`vi.mock` のファクトリは**ファイルの import より前に**巻き上げられて実行されるので、ファクトリは
通常の import を閉じ込められない。したがって足場を共有するには、

- 状態を `vi.hoisted` で作る（`const` ではダメ。ファクトリ実行時に TDZ になる）
- ファクトリ内で `await import` してヘルパーを取りに行く

という形が要る。**このパターンが実際に動くかを、使い捨ての probe spec で先に確認した**（`attach()`
まで通し、`termState.options.macOptionIsMeta` と `keyState.handler` が埋まることを確認）。動かない
設計の上に分割を積むと、全部書き直しになるため。

```ts
const { termState, keyState } = await vi.hoisted(async () => (await import("../../helpers/xtermDouble")).createXtermState());
vi.mock("@xterm/xterm", async () => (await import("../../helpers/xtermDouble")).xtermModule(termState, keyState));
```

## やること

### 1. `test/helpers/xtermDouble.ts`（新規）

`createXtermState()` / `xtermModule()` / `fitAddonModule()` / `webLinksAddonModule()` /
`clipboardAddonModule()` / `FakeWebSocket` / `useFakeWebSocket()` を export。

**グローバル mock にはしない。** `mouseTrackingGuard.spec.ts` は**実物の Terminal** を使って
ガードの挙動を見ているので、ダブルはファイル単位の opt-in のままでなければならない。

### 2. spec を関心ごとに 3 分割

`describe` の内側を切り刻むのは避け、**`describe` 単位で移す**（移設ミスの余地を作らないため）。

| ファイル | 中身 | 概算 |
| --- | --- | --- |
| `useTerminalConnections.spec.ts`（既存） | detached-slot の replay / Enter 配線 / 入力分類 / マウスガード登録 / `setFont` | 約 390 行 |
| `terminalConnectionsSubmit.spec.ts`（新規） | `makeEnterHandler` / `submitText` / `pasteAndSubmit` / `makeSendHandler` / `isClaudeTarget` | 約 310 行 |
| `terminalConnectionsClipboard.spec.ts`（新規） | `isSystemClipboard` / copy-on-select の配線 / OSC 8 リンク | 約 265 行 |

3 つとも 600 行を下回る。

### 3. 検証

- **テスト本数が減っていないこと**を数で確認する（分割は「動かす」作業で、落とす作業ではない）。
- `yarn lint` の `max-lines` warning が `useTerminalConnections.spec.ts` について消えること。
- 移設したテストが**素通りしていない**ことを確認する。分割の失敗は「mock が効かず全部 skip / 通過」
  という形で出るので、ダブルに依存する describe を 1 つ選び、実装を変異させて落ちることを見る。

## やらないこと

`max-lines` の上限を上げる、`eslint-disable` で黙らせる、テストの中身を書き換える。
これは**移設だけ**の変更で、アサーションは 1 行も変えない。
