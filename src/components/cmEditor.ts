// Thin CodeMirror 6 wrapper for the Files view's editor: build/destroy an EditorView,
// swap the document + language when a different file is opened, and read it back on
// save. Kept out of the .vue file so the language-by-extension logic is unit-testable
// without a DOM.
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

export type LangKind = keyof typeof LANG_EXTENSIONS | "text";

// Which extensions each bundled mode claims. One table rather than a chain of ifs, so adding a
// language is one line and nothing can claim an extension twice (a spec checks that).
//
// `html` covers .vue / .svelte / .astro deliberately: a single-file component IS an HTML document
// with <script> and <style> in it, and CodeMirror's html mode already switches into JS and CSS
// inside those tags. A dedicated Vue mode would colour the template marginally better; this
// colours all three today, for one dependency.
const EXTENSIONS_BY_KIND = {
  markdown: ["md", "markdown", "mdx"],
  javascript: ["js", "jsx", "ts", "tsx", "mjs", "cjs"],
  json: ["json", "jsonc", "json5"],
  html: ["html", "htm", "vue", "svelte", "astro"],
  css: ["css", "scss", "less", "sass"],
  yaml: ["yaml", "yml"],
  xml: ["xml", "svg", "xsl", "plist"],
  python: ["py", "pyi", "pyw"],
  rust: ["rs"],
  go: ["go"],
  java: ["java", "kt", "kts"],
  cpp: ["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "m", "mm"],
  php: ["php"],
  sql: ["sql"],
} as const;

// `Object.entries` widens the table's keys back to `string`; this carries them back into the type
// without asserting, so a kind added to the table above is picked up here with no second list.
const isLangKind = (kind: string): kind is LangKind => Object.prototype.hasOwnProperty.call(EXTENSIONS_BY_KIND, kind);

// Pick a syntax mode from a filename's extension. Only the modes we bundle are
// recognised; everything else edits as plain text.
export function langKindForFilename(name: string): LangKind {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "text"; // no extension (Makefile, LICENSE, …)
  const ext = name.slice(dot + 1).toLowerCase();
  // Over the table's own keys rather than Object.entries, which widens them back to `string` —
  // the two assertions this replaces were both undoing that widening.
  for (const [kind, exts] of Object.entries(EXTENSIONS_BY_KIND)) {
    if (exts.some((candidate: string) => candidate === ext) && isLangKind(kind)) return kind;
  }
  return "text";
}

// How each mode is obtained. The three that were here first stay bundled — markdown, JS/TS and
// JSON are what this app's own files are — while the rest are fetched when a file of that kind is
// first opened.
//
// Dynamic import is the exception the repo's rules allow ("conditional/optional dependencies that
// are not always loaded"), and it applies here: bundling all eleven cost 462 kB raw / 163 kB gzip
// on every page load, paid by everyone, for grammars most sessions never touch. Swapping the mode
// in later is free — the language already lives in a Compartment so it can be reconfigured.
const LANG_EXTENSIONS = {
  markdown: () => markdown(),
  javascript: () => javascript({ typescript: true }),
  json: () => json(),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
} satisfies Record<keyof typeof EXTENSIONS_BY_KIND, () => Extension | Promise<Extension>>;

/** Exported for the spec: which modes cost a round trip is a decision worth pinning. */
export function langExtensionForKind(kind: LangKind): Extension | Promise<Extension> {
  return kind === "text" ? [] : LANG_EXTENSIONS[kind]();
}

export interface CmEditor {
  setDoc(text: string, filename: string): void;
  getDoc(): string;
  destroy(): void;
}

// `onChange` fires only on USER edits — loading a file (setDoc) is programmatic and
// must not mark the buffer dirty, so it's suppressed with a flag.
export function createEditor(parent: HTMLElement, onChange: () => void): CmEditor {
  const lang = new Compartment();
  let loading = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        basicSetup,
        oneDark,
        lang.of([]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !loading) onChange();
        }),
      ],
    }),
  });
  // Which file the editor is showing NOW. A lazily-imported grammar can land after the user has
  // already opened something else, and applying it then would colour the new file as the old
  // one's language — the same staleness guard the fetch-per-cwd code uses.
  let docSeq = 0;

  return {
    setDoc(text, filename) {
      const seq = ++docSeq;
      const kind = langKindForFilename(filename);
      const mode = langExtensionForKind(kind);
      loading = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        // A bundled mode is applied with the text, in one transaction. A lazy one starts as no
        // highlighting and arrives below — the file is readable either way, it just goes from
        // plain to coloured.
        effects: lang.reconfigure(mode instanceof Promise ? [] : mode),
      });
      loading = false;
      if (mode instanceof Promise) {
        void mode
          .then((extension) => {
            if (seq === docSeq) view.dispatch({ effects: lang.reconfigure(extension) });
          })
          .catch(() => {
            // A grammar that fails to load leaves the file as plain text, which is what it was
            // before this existed. Nothing to report to the user.
          });
      }
    },
    getDoc: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
  };
}
