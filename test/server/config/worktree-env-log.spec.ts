// @vitest-environment node
import { describe, it, expect } from "vitest";
import { heldReservation, parseReservations, releaseLine, reservationLine, type WorktreeEnvReservation } from "../../../server/config/worktree-env-log";

const entry = (over: Partial<WorktreeEnvReservation> = {}): WorktreeEnvReservation => ({
  dir: "/w/fix-login",
  name: "PORT",
  kind: "port",
  base: 3000,
  value: "3010",
  ...over,
});

const log = (...lines: string[]): string => lines.join("");

describe("parseReservations", () => {
  it("reads back what the writers appended", () => {
    expect(parseReservations(log(reservationLine(entry())))).toEqual([entry()]);
  });

  // Ordering is the whole point of replaying rather than unioning: a re-reservation must not
  // leave the value it replaced behind, or the old port stays out of circulation forever.
  it("lets a later line for the same directory and variable win", () => {
    const parsed = parseReservations(log(reservationLine(entry()), reservationLine(entry({ value: "3020" }))));
    expect(parsed).toEqual([entry({ value: "3020" })]);
  });

  it("keeps two variables of one directory apart", () => {
    const parsed = parseReservations(log(reservationLine(entry()), reservationLine(entry({ name: "API_PORT", base: 4000, value: "4010" }))));
    expect(parsed.map((r) => r.name).sort()).toEqual(["API_PORT", "PORT"]);
  });

  it("drops everything a released directory held", () => {
    const lines = log(
      reservationLine(entry()),
      reservationLine(entry({ name: "DB_NAME", kind: "slug", base: null, value: "app_x" })),
      releaseLine({ dir: "/w/fix-login" }),
    );
    expect(parseReservations(lines)).toEqual([]);
  });

  // A rename drops ONE variable while the directory lives on — the whole-directory release is for
  // a worktree that is gone.
  it("releases one named variable, leaving the directory's others alone", () => {
    const other = entry({ name: "DB_NAME", kind: "slug", base: null, value: "app_x" });
    expect(parseReservations(log(reservationLine(entry()), reservationLine(other), releaseLine({ dir: "/w/fix-login", name: "PORT" })))).toEqual([other]);
  });

  it("releases only the named directory", () => {
    const other = entry({ dir: "/w/add-search", value: "3020" });
    expect(parseReservations(log(reservationLine(entry()), reservationLine(other), releaseLine({ dir: "/w/fix-login" })))).toEqual([other]);
  });

  // A file cut off mid-append costs its last line and nothing else — the reason the newline
  // leads rather than trails.
  it("drops an unparseable line on its own", () => {
    const lines = log(reservationLine(entry()), "\n{ not json", reservationLine(entry({ name: "API_PORT", base: 4000, value: "4010" })));
    expect(
      parseReservations(lines)
        .map((r) => r.name)
        .sort(),
    ).toEqual(["API_PORT", "PORT"]);
  });

  it("drops a line whose shape is wrong", () => {
    expect(parseReservations('\n{"dir":"/w/x","name":"PORT","kind":"nonsense","base":3000,"value":"3010"}')).toEqual([]);
    expect(parseReservations('\n{"dir":"/w/x","name":"PORT","kind":"port","base":3000}')).toEqual([]);
  });

  // The cross-process tiebreak reads holders[0] as the winner, so LOG ORDER is load-bearing:
  // two servers must compute the same winner from the same bytes, or both yield (or neither).
  it("returns entries in the order the log first records them", () => {
    const first = entry({ dir: "/w/a" });
    const second = entry({ dir: "/w/b", value: "3020" });
    expect(parseReservations(log(reservationLine(first), reservationLine(second))).map((r) => r.dir)).toEqual(["/w/a", "/w/b"]);
  });

  // What a LOST RACE must write. By the time the loser gets to release, a concurrent call for the
  // same (dir, name) may already have recorded a good reservation, and a release keyed only by the
  // variable would wipe a value a terminal is running on (Codex review on #1367).
  it("releases a variable only while it still holds the named value", () => {
    const stale = entry({ value: "3010" });
    const current = entry({ value: "3020" });
    // The loser's release names 3010; the row now holds 3020, so it must survive untouched.
    expect(parseReservations(log(reservationLine(stale), reservationLine(current), releaseLine({ dir: stale.dir, name: "PORT", value: "3010" })))).toEqual([
      current,
    ]);
    // And it does still release when the value IS the one that lost.
    expect(parseReservations(log(reservationLine(stale), releaseLine({ dir: stale.dir, name: "PORT", value: "3010" })))).toEqual([]);
  });

  it("reads an empty or blank log as nothing held", () => {
    expect(parseReservations("")).toEqual([]);
    expect(parseReservations("\n\n  \n")).toEqual([]);
  });
});

describe("heldReservation", () => {
  it("finds what this directory holds for this variable", () => {
    expect(heldReservation([entry()], "/w/fix-login", "PORT", 3000)).toEqual(entry());
  });

  it("does not answer for another directory or another variable", () => {
    expect(heldReservation([entry()], "/w/add-search", "PORT", 3000)).toBeNull();
    expect(heldReservation([entry()], "/w/fix-login", "API_PORT", 3000)).toBeNull();
  });

  // Editing `base` in the project's config must move the value. Otherwise a project that went
  // from 3000 to 4000 keeps exporting 3010 with nothing anywhere saying why.
  it("ignores a reservation made against a different base", () => {
    expect(heldReservation([entry()], "/w/fix-login", "PORT", 4000)).toBeNull();
  });

  it("matches a slug's absent base", () => {
    const slug = entry({ name: "DB_NAME", kind: "slug", base: null, value: "app_x" });
    expect(heldReservation([slug], "/w/fix-login", "DB_NAME", null)).toEqual(slug);
  });
});
