# The two gaps left in the dropped-input notice (#1315, #1316)

#1306 made a keystroke that never reached the PTY say so. Two things it left open, both found
reviewing it, both in the same function — so one change.

## #1315 — the GUI paths are still silent

`submitText` / `pasteText` / `pasteAndSubmit` return `false` when the socket is not `OPEN` and
tell nobody. Of their callers only `TerminalCell.vue` reads the result (it shows "Couldn't reach
the session"); the header button (`useHeaderAction.ts`) and the Skill menu (`Terminal.vue`) drop
it, so pressing either while disconnected does nothing and explains nothing.

Worse than the keystroke case it was fixed alongside: someone who pressed a button has no sense
of having typed, so the natural reading is "this button is broken", not "I am disconnected".

**Fix.** Every send function calls `reportDroppedInput(c)` on the closed-socket branch. Every host
then gets the banner without touching a call site — including hosts written later, which is the
point: the silence came from each caller having to remember.

`insertText` belongs in that set too (Codex caught it missing): voice transcription, a dropped
path and a pasted screenshot's path all arrive through it, and there the user is watching the
input box rather than waiting for a reply — so nothing on screen moves at all.

Empty text is NOT a drop (`pasteText("")` never had anything to deliver), so it must not notify.

**Wording.** "what you typed" is wrong for a button press. Both sentences move to "what you sent",
which covers a keystroke and a button equally.

## #1316 — the banner is shown once per disconnected stretch

`warnedDroppedInput` clears only in `sock.onopen`, and the backoff retries forever at a 5s cap.
A server that stays down leaves one stretch running for hours while the banner lives 6 seconds,
so the second time someone comes back and types they get the silence this exists to break.

**Fix.** Keep the once-per-stretch rule for the LOG line (a post-mortem needs one line, not
fifty) and put the banner on a cooldown that matches its own on-screen life. Key repeat still
cannot produce a stream — the next notice cannot land until the previous one is gone.

Both fields reset in `sock.onopen`: a new stretch deserves an immediate notice, not the tail of
the previous stretch's cooldown.

## Tests

- each of the three send functions notifies (and returns false) on a closed socket
- empty text notifies nothing
- two drops inside the cooldown produce one banner, one log line
- a drop after the cooldown produces a second banner, still one log line
- a successful reconnect re-arms both

`Date.now` is stubbed rather than the timers faked: the cooldown is the only clock involved, and
the specs around this already drive real `setTimeout` for the #846 probe.

## Not in scope

The delayed submit byte inside `submitText` / `pasteAndSubmit` skips when the socket changed
mid-flight. That is deliberate (it must never submit a stray turn into a reconnected session) and
the text itself did arrive, so it is not the same silence.
