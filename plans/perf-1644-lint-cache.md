# #1644 — cache the lint

## The problem

`yarn lint` is `eslint .`, uncached. 57.8s locally; 105s (ubuntu) / 111s (macOS) in CI, where it
is the second-heaviest step after the test suite.

## The change

```
"lint": "eslint . --cache --cache-strategy content"
```

plus `.eslintcache` in `.gitignore`, and an `actions/cache` entry in `ci.yml` so the CI runs share
one cache file.

## Why `--cache-strategy content` rather than the default

The default strategy is `metadata`, which decides whether a file changed by its **mtime**.
`actions/checkout` writes every file fresh on every run, so on a CI runner every file looks
changed and a restored cache buys nothing.

Measured by touching 400 source files without changing their content — the shape a fresh checkout
produces:

| strategy | after mtime-only change |
|---|---:|
| `metadata` (default) | 17.0s |
| `content` | **1.7s** |

Locally the two are indistinguishable (1.5s vs 1.7s warm), so one flag serves both and there is no
reason to carry two spellings.

## Measurements behind the change

`eslint@10.8.1`, this repo. "Result" is whether the run reported the baseline's problems
(0 errors, 14 warnings).

| variant | time | result |
|---|---:|---|
| `eslint .` (today) | 57.8s | baseline |
| `--cache`, cold | 50.9s | identical |
| `--cache`, warm, nothing changed | **1.5s** | identical |
| `--cache`, warm, one file edited | 2.6s | caught the new errors |
| `--cache`, after an `eslint.config.js` edit | — | cache invalidated, 93 new errors found |

The last two rows are the ones that make it safe to adopt: a cache that hid a new error, or that
survived a rule change, would be worse than no cache. Both were tested by actually introducing the
change and reading what the run said, then reverting.

## What was rejected, and why it is not in the diff

`--concurrency auto` finishes in **16.8s — 3.4x faster than the baseline** — and is wrong here.
Every `.vue` file fails to parse:

```
Parsing error: ESLint was configured to run on `<tsconfigRootDir>/src/App.vue`
using `parserOptions.project`: <tsconfigRootDir>/tsconfig.app.json
However, that TSConfig does not include this file.
```

91 of them, one per `.vue` file, all carrying `ruleId: null` — parse failures, not rule
violations. `eslint.config.js` already passes `tsconfigRootDir: import.meta.dirname`, and the same
tree is clean single-threaded, so the worker threads are failing to place `.vue` files in the type
program. That belongs upstream; here it would only make `yarn lint` fail.

## CI cache shape

`actions/cache` with a per-run key and a prefix restore key, so each run restores the newest
previous cache and saves its own:

```
key:          eslint-cache-${{ runner.os }}-${{ github.run_id }}
restore-keys: eslint-cache-${{ runner.os }}-
```

A content-addressed key (`hashFiles`) would be wrong: the cache is *supposed* to be reused across
commits that changed source, since that reuse is the entire saving. ESLint decides per file what
is still valid, and it invalidates the whole cache itself when the config changes (measured
above), so the key does not have to encode either.

The file is 591 KB.

## Not included

- **`windows-daily.yaml`** also runs lint (106-134s), and would benefit. It has been red for many
  consecutive runs, so there is no green baseline to measure against — a change there could not be
  shown to have worked. Separate issue.
- **`--concurrency`** — see above.

## Verifying after merge

Local: `yarn lint` twice; the second should be ~2s. Change one file and run again; the new problem
must appear.

CI: the first run after merge is a cache miss by definition and shows nothing. Compare the `Lint`
step across two or three later runs:

```sh
gh api "repos/receptron/mulmoterminal/actions/runs/<RUN_ID>/jobs?per_page=50" \
  --jq '.jobs[] | "\(.name)", (.steps[] | "  \(.name)  \(.started_at) \(.completed_at)")'
```
