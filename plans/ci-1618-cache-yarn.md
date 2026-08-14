# #1618 — yarn caching across the workflows

## What the issue asked

Add `cache: yarn` to the `setup-node` steps in `codex_review.yaml`, `dead-code-scan.yaml` and
`windows-daily.yaml`, on the grounds that `ci.yml` caches and they do not.

## What is actually true

Measured from the jobs API over 27 runs (see numbers below), only **one** of the three is a real
gap. The other two are correct as they stand.

| workflow | runs `yarn install`? | verdict |
|---|---|---|
| `ci.yml` | yes, 2 jobs | already cached |
| `dead-code-scan.yaml` | yes | **the gap — fixed here** |
| `codex_review.yaml` | **no** | leave alone |
| `windows-daily.yaml` | yes | leave alone |
| `duplication-scan.yaml` | no (downloads a jscpd binary) | n/a |
| `pages.yml`, `pr_triage.yaml` | no node | n/a |

### `codex_review.yaml` — never installs the project

There is no `yarn` anywhere in the file. It `npm install -g`s the Codex CLI and nothing else, and
its review prompt states the arrangement outright: *"This checkout has NO project dependencies
installed — only the codex CLI itself."* Caching yarn's download folder there restores a 1.6 GB
tarball that no step reads. That is a ~18s loss per run for zero gain. Its existing `~/.npm` cache
is the one that matches what it does.

### `windows-daily.yaml` — already decided, with a reason

The file carries the decision in a comment: *"Deliberately no `cache: yarn`: restoring the yarn
cache tar onto NTFS is slower than a fresh install. node_modules is cached directly instead."*
It caches `node_modules` keyed on `matrix.node-version` + `hashFiles('yarn.lock')`, plus
`~/.cache/puppeteer`. The issue's worry about a `node_modules` cache restoring a foreign tree does
not apply: the runner is windows-only and the node version is in the key.

Overturning a documented decision needs a Windows measurement, and `windows-daily` is red on all
five of its recent runs (the `Test` step), so there is no clean baseline to measure against. Out
of scope here.

## The measurement

`setup-node` performs the cache **restore inside its own step**, so the comparison has to be
`setup-node + yarn install`, not `yarn install` alone. The issue's table quotes only the install
column and therefore overstates the gain by roughly 1.8x.

Medians, ubuntu, from `actions/runs/<id>/jobs`:

| | n | `setup-node` | `yarn install` | **sum** |
|---|---:|---:|---:|---:|
| `ci.yml` `lint-and-build (ubuntu-latest)` — cached | 12 | 20s | 20s | **38s** |
| `dead-code-scan` — uncached | 15 | 2s | 58s | **59s** |

Expected saving: **~20s per run**, about a third of that step pair — not the ~38s a
58s-vs-20s reading of the install column alone suggests.

## Why the first run is not a cache miss

The issue warns that the first run after the change pays the save cost and shows no saving. That
warning does not apply here. The restore key logged by `ci.yml` is:

```
node-cache-Linux-x64-yarn-3aa92fc03863d9b5c690db69623c75d198b7dac5560ca7f7e68671611ba15374
```

Platform, arch, package manager, lockfile hash — **no workflow name and no node version**.
`dead-code-scan` runs node 22 on ubuntu against the same single root `yarn.lock`, so it computes
that exact key and hits the entry `ci.yml` already maintains on main. Nothing extra is stored
(the entry is shared, not duplicated), and it is warm from the first run.

`cache-dependency-path` is left unset on purpose: the repo has exactly one lockfile, `yarn.lock`
at the root, which is already `setup-node`'s default. Naming it would change nothing.

## Verifying after merge

Compare the same two step names across several runs, not one pair:

```sh
gh api "repos/receptron/mulmoterminal/actions/runs/<RUN_ID>/jobs?per_page=50" \
  --jq '.jobs[] | "\(.name)", (.steps[] | "  \(.name)  \(.started_at) \(.completed_at)")'
```

Success is the **sum** of `setup-node` + `yarn install` landing near 40s, against the 59s median
above. A run where `setup-node` alone grew to ~20s is the cache working, not a regression.
