# refactor #1125 — wiki の描画面を 1 つにする（`WikiProse`）

#1125 の残課題 1 件目。PR #1138 が 8 件の `<style>` を 1 件に減らしたとき、Wiki の 2 セットだけ
「意図か drift か判別できない」として `src/style.css` にそのまま持ち込まれた。その判断を確定させる。

| セレクタ | 使う場所 | 見出し margin | leading | code の font-size |
|---|---|---|---|---|
| `.wiki-body h1,h2,h3` | WikiPageView（ページ本文） | `1.4em 0 0.5em` | 1.65 | `0.9em` |
| `.wiki-lint h1,h2` | WikiBrowseOverlay（lint レポート） | `1.2em 0 0.4em` | 1.6 | （無し） |

## drift だと判断した根拠

1. **両方とも同じコミットで生まれている。** `git log -S` で追うと `b6163f1f`（`feat(wiki): read-only
   Wiki browser (#165)`）が両方の値を同時に入れている。別々のコンポーネントに手で書かれた 2 ブロックで、
   差を説明するコメントは無い。
2. **見た目の前提が完全に同じ。** どちらも 820px カラム・`px-7 pt-6 pb-16`・14px 本文。「フルページ」と
   「コンパクトプレビュー」という #1138 時点の理解は実物と合っていない。lint も同じ幅の全画面ドキュメント。
3. **reference host が 1 つのコンポーネントで両方描いている。** MulmoClaude は lint レポートを
   ページ本文と同じ `WikiPageBody` に流している（`../mulmoclaude/src/plugins/wiki/View.vue:221-230`）。
   CLAUDE.md の「MulmoClaude is the reference host」に従うなら、2 セットに分ける理由が無い。
4. 差は h1 の上マージンで 0.2em = **2.8px**、leading で 1 行あたり 0.7px。#1138 が引いた
   「知覚できない差は受け入れる」の線の内側。

## 調査中に見つかった divergence（ユーザー判断で今回同時に直す）

lint レポートの本文には `[[broken link]]` が入る（core の `findBrokenLinksInPage` が
`- **Broken link** in \`x.md\`: [[foo]] → \`foo.md\` not found` を出す）。これは `renderWikiHtml` を
通るので `role="link" tabindex="0"` 付きの `.wiki-link` span になるが、**lint ビューには click /
keydown ハンドラが無い**。結果:

- 見た目はただの本文（`.wiki-lint .wiki-link` が無いので装飾ゼロ）
- キーボードではフォーカスできる
- クリックしても Enter を押しても何も起きない

`role="link"` を持つのに活性化できない要素で、MulmoClaude では同じレポートのリンクが遷移する。

## やること

**`src/components/WikiProse.vue` を新設し、レンダリング済み wiki markdown の描画面を 1 つにする。**
CSS を 2 セット併記で揃えるのではなく、**同じ物を同じコンポーネントで描く**（= reference host と同じ形）。

1. `WikiProse.vue` — props `{ html: string; graph: WikiGraph | null }`。`.wiki-body` コンテナ、
   `v-html`、`fileSlugs` / `slugByTitle`、`activateLink` / `onBodyClick` / `onBodyKeydown` を持つ。
   これらは今 `WikiPageView.vue` にあるものをそのまま移すだけ（ロジック変更なし）。
2. `WikiPageView.vue` — 上記を削って `<WikiProse :html="html" :graph="graph" />` に置換。
3. `WikiBrowseOverlay.vue` — lint の `<div class="wiki-lint …" v-html>` を、ページ本文と同じ
   コンテナ utilities + `<WikiProse :html="lintHtml" :graph="graph" />` に置換。
   `loadLint` は `loadPage` と同じく graph も併せて取る（title 経由でしか解決できないリンクを
   ページ本文と同じに解決させるため）。
4. `src/style.css` — `.wiki-lint` の 3 ルールを削除。`.wiki-body` の 1 セットだけ残す。
   コメントから「2 セットは product 判断待ち」を落とし、確定した理由に差し替える。
5. 両ファイル末尾に残っている**孤児コメント**（`<style>` を削った #1138 の残骸で、
   「Only the … stays scoped … must be reached via :deep」と書いてあるが scoped CSS はもう無い）を削除。
6. `test/src/components/WikiProse.spec.ts` — 決定を pin する:
   - lint とページが同じ描画コンポーネントを通ること（`WikiBrowseOverlay` / `WikiPageView` の両方で
     `WikiProse` が mount される）
   - `.wiki-body` クラスが付くこと（style.css の 1 セットが両方に当たる）
   - `.wiki-link` の click / Enter / Space が `wikiGotoPage` を呼ぶこと

## やらないこと

- **`TerminalGrid.vue` の 155 行**（#1125 の残課題 2 件目）はユーザー判断で現状維持。理由付きの
  例外コメントもそのまま。
- `.wiki-body` の見出し以外の値（`pre` / `blockquote` / `img` など）は触らない。
