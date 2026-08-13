# The `as` ban never reached a Vue template (#1339)

`@typescript-eslint/consistent-type-assertions` is `error` with `assertionStyle: "never"` and its
`files` list already names `**/*.vue`. It still reported nothing for

```vue
@input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
```

because `vue-eslint-parser` exposes the template as a **separate AST** and typescript-eslint's
rules only walk the script one. So the rule was configured, enabled, at error — and blind. When
#1231 took the app from 149 assertions to 0, this one was never in the count.

`@typescript-eslint/no-non-null-assertion` (on via `tseslint.configs.strict`) has exactly the same
blind spot, and the repo had one template `!` to prove it.

## Fix

`vue/no-restricted-syntax` is the one rule that does walk that AST, so the same two bans are
spelled there as selectors, in the existing `**/*.vue` block:

- `TSAsExpression` — the `as` cast
- `TSNonNullExpression` — the `!`

Straight to `error`, as the issue proposed: the whole repo had two findings, so `warn` would have
guarded nothing. Same severity as the script-side rules they extend, which is the point — a
template is not a place where the house style is looser.

`as const` is excluded from the `TSAsExpression` selector. `consistent-type-assertions` exempts it
in the script half, so without the exclusion one SFC would disagree with itself: legal above the
`<template>` line, an error below it. It is also outside what the ban is for — a const assertion
narrows a literal the compiler can already see, rather than claiming a type it could not prove.

## The two findings

Both fixed by narrowing in `<script>` rather than by asserting, which is what the ban is for.

- `SettingsField.vue` — the inline `$emit` becomes a named `onInput(e: Event)` that narrows with
  `e.target instanceof HTMLInputElement`. Matches `WebPushSection.vue` / `WaitingRowsSection.vue`,
  which already do this.
- `CellLaunchForm.vue` — `:title="mcpGroupFailed[group]!"` sat next to `v-else-if` on the same
  value, asserting in the hover what the branch had just tested. One accessor, `mcpGroupFailure`,
  now answers both, so they cannot disagree and neither asserts.

## What stops it coming back

A clean tree does not prove a rule fires — that is the whole failure here. `test/scripts/
eslint-template-assertions.spec.ts` reads the rule's options out of the REAL config
(`calculateConfigForFile`) and runs them over SFC text containing an `as` and a `!`. Deleting a
selector from `eslint.config.js` fails it; deleting the rule fails all of it.

Linted as text, not as a fixture file: anything under `src/**/*.vue` is parsed against
`tsconfig.app.json`, and a path outside it produces a parse error instead of a finding.

Component specs pin the two behaviours the narrowing moved: `SettingsField` still emits every
keystroke, and a failed MCP group write still puts its reason on the row's hover.

## The `.vue` exclusion note from #1300 is narrower than it read

#1300 closed saying ".vue exclusions are a limit of the linter". True of the `no-unsafe-*` family
— ESLint's type program does not generate SFC component types — and NOT true of the assertion
bans, which now cover both halves of an SFC. Both comment blocks in `eslint.config.js` say which
they are.
