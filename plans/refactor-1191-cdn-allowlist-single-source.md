# refactor: take the sandboxed-view CDN allowlist from core, not from a local copy

refs #1191 (item 4 of that memo; the other items are untouched here)

## The observation this starts from

`server/backends/html.ts:30-37` hand-maintains a six-entry CDN allowlist that feeds the
`Content-Security-Policy` of every LLM-authored HTML page this host serves — both the contained
`/artifacts/html/…` preview and the uncontained `/htmlfile` mount.

The same six entries live in `@mulmoclaude/core` as `SANDBOXED_VIEW_CDN_ALLOWLIST`, and core is
not a passive holder of them. MulmoClaude's `src/utils/html/previewCsp.ts:8-11` says so outright:

> The list itself lives in `@mulmoclaude/core/remote-view` (SANDBOXED_VIEW_CDN_ALLOWLIST) so the
> remote-view CSP and these desktop policies can't drift — **widen it THERE**, and keep it
> audited: every entry is a potential supply-chain surface.

So the list already HAS a declared owner, and this repo is the one host not reading from it.

## Why this is worth a change rather than a comment

The two lists are **identical today** — verified entry by entry against
`node_modules/@mulmoclaude/core/dist/remote-view/index.js`. Nothing is broken right now, and
that is precisely the problem: the day core adds a seventh entry, this file keeps six and
nothing anywhere fails. No type error (the local value is a fresh array literal), no test
(the specs assert CSP *directives*, never the CDN list — `test/server/backends/html.spec.ts:96-101`),
no lint. A security boundary that drifts silently is the failure mode worth spending a change on.

`CLAUDE.md` already states the general rule for the on-disk layout and the `/api/*` surface —
"MulmoClaude is the reference host, find its counterpart first". This is the same rule applied
to a shared constant.

## Decisions (owner, this session)

**1. Import the list; keep the joining and the CSP construction local.**

Core owns *which origins are trusted*. It does not own how this host assembles its CSP — the
`sandbox allow-scripts` / `connect-src 'none'` shape here is deliberately stricter than what a
collection custom view gets, and that stays this file's business. So the import replaces the
array literal only.

**2. Add a spec that pins the resolved allowlist.**

This is the part that is NOT mere deduplication, so it is called out for review.

Replacing a visible literal with an import *removes* the local record of what this host trusts.
Core's own instruction is "keep it audited" — an import with no assertion is the opposite: a
core release could widen the trusted set of this host's CSP and no one here would see it in a
diff or a test run.

The spec pins the exact six origins. When core widens the list the spec fails, a human reads
what was added, and updates the spec deliberately. That converts a silent supply-chain widening
into a one-line review. It is a **canary, not a duplicate**: it asserts on the imported value,
so it cannot drift from what is actually served.

**3. Do not touch the other five items in #1191.**

Item 1 (calendar scheduled sync) needs cross-process locking work first — core's calendar lock
is in-process module state by design. Item 2 has no UI affordance to break. Neither belongs in
this change.

## Steps

1. `server/backends/html.ts` — import `SANDBOXED_VIEW_CDN_ALLOWLIST` from
   `@mulmoclaude/core/remote-view`; `ALLOWED_CDNS` becomes its `.join(" ")`. Rewrite the comment
   to point at the owner and say "widen it there".
2. `test/server/backends/html.spec.ts` — pin the six origins, and assert the served CSP actually
   carries them (so the pin is tied to the response, not just to the constant).
3. Gate: `format` → `lint` → `typecheck` / `typecheck:server` / `typecheck:test` → `build` → `test`.

## What this does not change

No behaviour. The served CSP header is byte-identical as long as core's list is unchanged, which
step 2 is there to keep true.
