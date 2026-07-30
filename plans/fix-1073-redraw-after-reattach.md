# Ask tmux for the screen instead of rebuilding it from the replay

Follow-up to #1073. 2026-07-30.

## Why

The #1073 fix restores the alternate buffer on reattach, which is what puts the wheel back. It also
exposed a weakness that had been hidden: **the replay is a stream of DELTAS, not a screen.**

`entry.buffer` is the last 1 MiB of tmux's output. Fed to a terminal that was just `reset()`, it
reconstructs only the cells that happened to change inside that window. Rows that were painted
before the window opened are never mentioned, so they stay blank; cells written at different moments
end up side by side. For a TUI this is the normal case, not an edge case — Claude Code paints a
transcript row once and then spends megabytes rewriting one status row.

This did not show before because a pty **resize** makes tmux repaint everything, and the normal
buffer the replay used to land in **reflows**, so a late resize repaired whatever was wrong. Neither
is true now: a reattach that ends at the size the pty already had leaves tmux with nothing to say,
and the alternate buffer does not reflow.

Reported with a screenshot: text from different moments spliced together character by character,
and the lower half of the screen blank.

## What

After a reattach, ask tmux to repaint the whole pane:

- `server/infra/tmux.ts` — `tmuxRedrawClient(id, clientPid)`: `list-clients -F '#{client_pid}
  #{client_tty}'` for the session, then `refresh-client` on OUR client. `redrawTargets` is pure and
  tested.
- `server/session/types.ts` — `PtyEntry.redrawPending`.
- `server/session/pty-connection.ts` — `reattachPty` sets the flag (tmux sessions only); the first
  `resize` frame after that clears it and asks for the redraw.
- `server/index.ts` — binds the dep.

**Which client is repainted.** A session can carry several — another mulmoterminal server holding
it (what `tmuxAttachedClientCount` exists for), or a stray `tmux attach` — and tmux promises nothing
about `list-clients` order, so "the first line" can be somebody else's terminal while ours keeps the
broken screen. Ours is identifiable: the pty we spawned IS the tmux client, so `client_pid` is
`entry.term.pid`. Measured on a live session — list-clients reported `29421`, and the
`new-session -A -s mt-<id>` process we spawned was 29421. When no line carries our pid, every client
is repainted rather than none: a repaint is idempotent, and skipping ours is the one outcome that
leaves the bug in place. (Raised by Codex on PR #1099; the first version took the first line.)

**Why the redraw waits for the resize frame** rather than firing with the replay: that frame is
where the client reports the size it actually settled at, so the repaint is drawn at the right
geometry. The client always sends one on `onopen`.

## Measured

`refresh-client` really does force a FULL repaint, on a live session: a 25-row screen comes back in
one 666-byte burst, where the same pane sends **0** bytes when idle.

End to end against a real server, reattaching at the size the pty already had, with the current
screen deliberately older than the replay window (one row rewritten past 1 MiB while the rest stays
untouched) — ground truth is `tmux capture-pane`:

```
                            without redraw     with redraw
rows matching tmux            25 / 30           30 / 30
MARKER rows shown (tmux has 1)  0                 1
```

## What this cost

One `list-clients` + one `refresh-client` per reattach (~14 ms), plus a screen-sized burst (~1 KB).
Every reattach pays it, including ones that would have been fine — the screen becoming authoritative
is worth more than skipping the repaint on the cases we cannot identify in advance.

## What the first fix got wrong

#1073's verification compared the rendered screen with and without the mode prefix and found them
identical — but only at a **fixed size, with the whole replay window containing the current screen**.
Neither assumption holds for a returning background tab. The check that would have caught this is
the one used here: compare against `tmux capture-pane`, not against the other rendering.
