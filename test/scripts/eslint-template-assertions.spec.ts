// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { ESLint, Linter } from "eslint";
import pluginVue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import tseslint from "typescript-eslint";

// `@typescript-eslint/consistent-type-assertions` and `no-non-null-assertion` are configured at
// error for `.vue`, and both were blind to the TEMPLATE: typescript-eslint's rules only walk the
// script AST, so an `as` inside `@input="…"` passed a ban set to "never" (#1339). The template
// side is `vue/no-restricted-syntax`, and the failure it fixes is a rule that is CONFIGURED but
// never reports — which no amount of clean source proves. So this lints real SFC text.
const RULE = "vue/no-restricted-syntax";

// Linted as text rather than as a fixture file: anything under `src/**/*.vue` is parsed against
// tsconfig.app.json, and a path outside it is a parse error instead of a finding. The rule is
// syntactic, so the template AST from vue-eslint-parser is all it needs — with the options read
// from the real config, which is what makes deleting a selector there fail here.
let ruleOptions: Linter.RuleEntry;

const lintTemplate = (body: string): Linter.LintMessage[] =>
  new Linter().verify(`<template>\n  ${body}\n</template>\n`, {
    // The template's expressions are TypeScript, and vue-eslint-parser hands them to whatever
    // `parserOptions.parser` names — espree without this, which produces no TSAsExpression node
    // for the rule to match and no error either. Same wiring as the `.vue` block in the config.
    languageOptions: { parser: vueParser, parserOptions: { parser: tseslint.parser } },
    plugins: { vue: pluginVue },
    rules: { [RULE]: ruleOptions },
  });

describe("the template-side assertion ban", () => {
  beforeAll(async () => {
    const config = await new ESLint().calculateConfigForFile("src/components/SettingsField.vue");
    ruleOptions = config.rules[RULE];
  });

  it("is configured at error for .vue files", () => {
    expect(Array.isArray(ruleOptions) ? ruleOptions[0] : ruleOptions).toBe(2);
  });

  it("reports an `as` cast written in a template expression", () => {
    const messages = lintTemplate(`<input @input="emit('v', ($event.target as HTMLInputElement).value)" />`);
    expect(messages.map((m) => m.ruleId)).toEqual([RULE]);
  });

  it("reports a non-null assertion written in a template expression", () => {
    const messages = lintTemplate(`<span :title="failed[group]!">failed</span>`);
    expect(messages.map((m) => m.ruleId)).toEqual([RULE]);
  });

  it("leaves a template that narrows in <script> alone", () => {
    expect(lintTemplate(`<span :title="failure(group)">failed</span>`)).toEqual([]);
  });

  // A const assertion is legal in the script half (consistent-type-assertions exempts it), so a
  // template that rejected it would make one SFC disagree with itself — and it is not what the ban
  // is about: it narrows a literal already in front of the compiler, it does not claim a type.
  it("leaves `as const` alone, as the script-side rule does", () => {
    expect(lintTemplate(`<span :title="pick(['a', 'b'] as const)">failed</span>`)).toEqual([]);
  });
});
