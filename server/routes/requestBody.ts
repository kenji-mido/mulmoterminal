// Reading a POST body without `any`.
//
// Express types `req.body` as `any`, so `req.body.slug` type-checks against every use and every
// value read out of it stays `any` all the way to whatever it is handed to. That is the widest
// `any` door in the server: the value came from outside, and nothing has checked it.
//
// Answering a plain record makes each field `unknown`, which the handlers already treat correctly
// — they were written as `typeof req.body?.x === "string" ? ... : default`, and that guard is now
// the thing the type checker follows rather than decoration on an `any`.

import { isRecord } from "../../common/isRecord.js";

/** A POST body as a record of unverified fields; `{}` when the request carried no JSON object. */
export const requestBody = (body: unknown): Record<string, unknown> => (isRecord(body) ? body : {});
