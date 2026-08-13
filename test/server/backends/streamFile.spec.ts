// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Response } from "express";
import { streamErrorAction, streamFileToResponse } from "../../../server/backends/streamFile.js";
import { makeTempDir } from "../../support/tempDir";

describe("streamErrorAction", () => {
  it("sends a 500 while the response is still open", () => {
    expect(streamErrorAction(false)).toBe("500");
  });
  // Once bytes are on the wire the status is fixed, so the only honest move is to abort.
  it("destroys the connection once headers have been sent", () => {
    expect(streamErrorAction(true)).toBe("destroy");
  });
});

// A fake express Response backed by a real Writable so `.pipe(res)` works. `destroy`
// already exists on Writable (so it's spied, not reassigned); `status`/`json` are added.
function fakeRes(headersSent: boolean) {
  const stream = new PassThrough();
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const destroy = vi.spyOn(stream, "destroy");
  Object.assign(stream, { headersSent, status, json });
  const res = stream as unknown as Response;
  return { res, stream, status, json, destroy };
}

// Real file I/O has no settle time we can name: on a loaded Windows runner the open hadn't
// even delivered a byte after the 20ms sleep this used to use, so the test read an empty
// buffer and failed. Wait for the outcome itself instead of guessing how long it takes.
const SETTLE_TIMEOUT_MS = 3000;

describe("streamFileToResponse", () => {
  it("serves an existing file", async () => {
    const dir = makeTempDir("mt-stream-");
    const file = path.join(dir, "a.txt");
    writeFileSync(file, "hello");
    const { res, stream, status } = fakeRes(false);
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    streamFileToResponse(file, res);
    // The pipe ends the response once the file is drained, so by then `chunks` holds it all.
    await vi.waitFor(() => expect(stream.readableEnded).toBe(true), { timeout: SETTLE_TIMEOUT_MS });
    expect(Buffer.concat(chunks).toString()).toBe("hello");
    expect(status).not.toHaveBeenCalled();
  });

  // Regression (#744): the read stream errored with no handler → uncaughtException and a
  // hung request. A file that can't be opened must now yield a clean 500.
  it("responds 500 when the file can't be read and nothing was sent yet", async () => {
    const { res, status, json, destroy } = fakeRes(false);
    streamFileToResponse(path.join(tmpdir(), "does-not-exist-xyz.bin"), res);
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith(500), { timeout: SETTLE_TIMEOUT_MS });
    expect(json).toHaveBeenCalledWith({ error: "failed to read file" });
    expect(destroy).not.toHaveBeenCalled();
  });

  it("destroys the connection when the stream errors after headers were sent", async () => {
    const { res, status, destroy } = fakeRes(true);
    streamFileToResponse(path.join(tmpdir(), "does-not-exist-xyz.bin"), res);
    await vi.waitFor(() => expect(destroy).toHaveBeenCalled(), { timeout: SETTLE_TIMEOUT_MS });
    expect(status).not.toHaveBeenCalled();
  });
});
