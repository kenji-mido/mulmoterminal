import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import sonarjs from "eslint-plugin-sonarjs";
import security from "eslint-plugin-security";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default [
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...pluginVue.configs["flat/recommended"],
  sonarjs.configs.recommended,
  security.configs.recommended,
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/max-attributes-per-line": "off",
      // Components are styled with Tailwind utilities (docs/styling.md) so the styling
      // travels with the markup. A <style> block is the exception, not the default —
      // add the file to the allowlist below WITH a reason rather than disabling inline.
      "vue/no-restricted-block": [
        "error",
        {
          element: "style",
          message:
            "Use Tailwind utilities (see docs/styling.md). If this genuinely can't be a utility, add the file to the scoped-CSS allowlist in eslint.config.js with a reason.",
        },
      ],
    },
  },
  {
    // Scoped-CSS allowlist. Each entry is something Tailwind utilities cannot express;
    // keep the reason current, and delete the entry when the reason goes away.
    files: [
      "src/components/Sidebar.vue", //            @keyframes — the "thinking" spinner ring
      "src/components/SessionTabBar.vue", //      @keyframes — the same spinner
      "src/components/Terminal.vue", //           @keyframes — the voice button's pulse / spin
      "src/components/TerminalGrid.vue", //       parent-state x descendant layout machine + FLIP @keyframes
      "src/components/GuiPanel.vue", //           `.frame + .frame` sibling-combinator spacing
      "src/components/WikiPageView.vue", //       :deep into v-html markdown
      "src/components/WikiBrowseOverlay.vue", //  :deep into v-html lint output
      "src/components/FilesOverlay.vue", //       :deep into CodeMirror's injected root
      "src/components/ToolbarPopover.vue", //     shared popover chrome import
    ],
    rules: { "vue/no-restricted-block": "off" },
  },
  {
    files: ["server/**/*.{js,mjs}", "bin/**/*.js", "scripts/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // The launcher's job is to run the user's installed CLIs — claude, gh, tmux,
    // codex, git — which have no portable absolute path and are found on PATH by
    // design. no-os-command-from-path fights that premise on every spawn, so it
    // is off here rather than suppressed inline at each call.
    files: ["bin/**/*.js"],
    rules: {
      "sonarjs/no-os-command-from-path": "off",
    },
  },
  {
    // Complexity / size guards. Cognitive complexity is already covered by sonarjs
    // (error@15). All ERRORS (enforced going forward) except max-params, which stays WARN
    // for its one intentional offender: spawnClaudePty's 7 params (hot path, not worth
    // churning 5 call sites into an options object) — flip it to error once resolved.
    //
    // max-lines is per FILE and was the gap: the per-function guards were all passing while
    // TerminalCell.vue reached 2000 lines, because nothing was watching the file. Counted
    // without comments, which is why the three heavily-documented 800+ line files
    // (useTerminalConnections.ts, server/index.ts, collections.ts) are already under it —
    // long because they explain themselves, not because they do too much.
    rules: {
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
      complexity: ["error", 20],
      "max-depth": ["error", 4],
      "max-params": ["warn", 6],
      "max-nested-callbacks": ["error", 4],
    },
  },
  {
    // no-redundant-optional assumes `?: T` already admits undefined, so `?: T | undefined`
    // says nothing new. Every tsconfig here sets exactOptionalPropertyTypes, which makes the
    // two DIFFERENT types — `?: T` forbids the key from holding undefined — so the rule's
    // premise no longer holds and it flags the only way to spell "undefined is a valid value".
    // Turn it back on if the flag ever comes off.
    rules: {
      "sonarjs/no-redundant-optional": "off",
    },
  },
  {
    // `const { secret, ...rest } = obj` is how you drop a field by construction —
    // the named siblings are the point, not dead code. Scoped to where the
    // typescript-eslint rule owns unused-vars; plain .js keeps the plugin default.
    files: ["**/*.{ts,tsx,mts,cts}", "**/*.vue"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    // Test files: a describe/it suite is one big (nested) callback by design, so the
    // length + callback-nesting guards are noise here. Keep the logic-complexity guards on.
    files: ["**/*.spec.{ts,js}", "**/*.test.{ts,js}"],
    rules: {
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      // The FILE limit still applies here, but as a warning: a 1900-line spec is worth
      // seeing, and yet splitting one moves assertions away from each other — the same
      // trade-off the paragraph below describes for stubs. Warn says so without making a
      // long-standing spec block anyone's CI.
      "max-lines": ["warn", { max: 600, skipBlankLines: true, skipComments: true }],
      // Same reasoning for components: a spec defines throwaway stubs next to the case that
      // uses them (useCaptureKeydown, useNewTerminal). Splitting one-line stubs into their own
      // files would put the fixture further from the assertion, which is the opposite of what
      // the rule is for — it exists to keep SHIPPED components findable.
      "vue/one-component-per-file": "off",
    },
  },
  {
    // The files that already exceed max-lines, listed here rather than silenced with
    // eslint-disable comments so the debt is countable in one place (CLAUDE.md forbids the
    // comments, and rightly — they hide at the scene). Delete an entry once its file is under
    // the limit; the rule then holds it there.
    files: [
      "src/components/TerminalCell.vue", // 1078 — the launch form is out (#1122); the running cell's chrome (header chips, diff panel, close confirm, handoff menu) is what's left
      "src/components/TerminalGrid.vue", //  815 — layout state machine + its documented <style> exception (#1125)
    ],
    rules: {
      "max-lines": "off",
    },
  },
  {
    // eslint-plugin-security tuning (mirrors mulmoclaude): these three rules fire
    // on safe, intentional patterns here — workspace-relative fs paths (session
    // files keyed by validated UUIDs), dynamic `obj[key]` lookups, and regexps —
    // so they're high-noise, low-signal. The rest of `recommended` stays on.
    rules: {
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-object-injection": "off",
      "security/detect-non-literal-regexp": "off",
    },
  },
  prettierRecommended,
];
