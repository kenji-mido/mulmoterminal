# `yarn lint:summary` — lint findings as a report

## What

`eslint .` says what is wrong file by file. It does not say *where* the problems are — which area
carries them, which rule dominates, which directory to start in. This adds that view.

- `yarn lint:summary` — markdown report to stdout, for reading locally.
- `yarn lint` now runs through `scripts/eslint-formatter-summary.mjs`, which prints the same
  `stylish` output as before **and**, when `GITHUB_STEP_SUMMARY` is set, appends the report to the
  CI job summary.

## Why a formatter rather than a second lint run

ESLint emits one format per run. Getting both the human log and the report would otherwise mean
linting twice — ~60s each. The formatter renders `stylish` itself and writes the report on the way
past, so it costs one run and no workflow edit: the flag lives in the `lint` script CI already
calls.

Outside Actions `GITHUB_STEP_SUMMARY` is unset and nothing is written, so a terminal run behaves
exactly as it did.

## Areas

`AREAS` is this repo's own split, per CLAUDE.md's Layout section, ordered by how many files each
holds (measured): `test` 671, `server` 408, `src` 310, `common` 82, `bin` 16, `scripts` 6.
Anything else — the root config files — falls into `other`.

This is the one thing to re-check if the repo is reorganised: a top-level directory missing from
the list silently lands in `other` rather than erroring.

## Not included: `--concurrency`

The script this was modelled on carries `--concurrency=auto`. It is deliberately absent here. On
this repo it is 3.4x faster (57.8s -> 16.8s) and **wrong**: every `.vue` file fails to parse under
worker threads, 91 findings with `ruleId: null`.

```
Parsing error: ESLint was configured to run on `<tsconfigRootDir>/src/App.vue`
using `parserOptions.project`: <tsconfigRootDir>/tsconfig.app.json
However, that TSConfig does not include this file.
```

`eslint.config.js` already sets `tsconfigRootDir: import.meta.dirname` and the same tree is clean
single-threaded, so this is worker threads failing to place `.vue` files in the type program.
A summary built on it would be mostly noise.

## Not included: an npm package

Checked before writing this. `eslint-formatter-summary` (84k weekly) aggregates **by rule only**,
in chalk-coloured terminal output. `eslint-formatter-gha` (45k weekly) emits GitHub **annotations**.
Neither writes `GITHUB_STEP_SUMMARY`, and neither produces the area breakdown, the rule x area
table or the directory ranking — verified by unpacking both and grepping. The by-rule half is
available off the shelf; the part that makes the report readable is not.

`eslint-formatter-gha` would compose with this rather than replace it (annotations in the diff vs.
a summary of the whole run) — worth its own issue, not this one.

## Verified

- `yarn lint` output is byte-identical to `eslint .` (diff clean apart from yarn's own wrapper).
- With `GITHUB_STEP_SUMMARY` pointed at a file, the report is appended (34 lines); unset, nothing
  is written.
- Warnings only -> both scripts exit **0**, so CI is not failed by the 14 existing warnings.
  Errors -> `lint:summary` exits 1, which is why the entry point re-derives the status: a pipeline
  reports the last command's code, so eslint's is lost at the pipe.
- Report totals match the plain run (14 problems: test 8, server 3, src 2, common 1).
- `prettier --check` clean on both scripts and `package.json`.
