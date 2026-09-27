/**
 * The check-runs endpoint answering as it does to an expired token.
 *
 * `MAPLE_GATE_TOKEN` is a static installation token, which GitHub expires after
 * an hour, so this is the failure a long agent session actually meets.
 */

import { http, HttpResponse } from "msw";

const CHECKS = "https://api.github.com/repos/:owner/:repo/commits/:sha/check-runs";

/** Every check-run read fails with 401 Bad credentials. */
export const expiredGateToken = http.get(CHECKS, () =>
  HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
);
