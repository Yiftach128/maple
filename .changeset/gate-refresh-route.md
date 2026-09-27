---
"@maple-kit/core": minor
---

The route gains `POST /gate/refresh`, switched on with `RouteOptions.gateRefresh: { owner, repo, store? }`. The caller sends `{ branch }` and its own GitHub token as `Authorization: Bearer`; the route checks the token has push access to the repository (cached for a minute, keyed by a hash of the token), reads the store, runs `decideGate` and publishes with its own `gate`. It answers `{ branch, sha, verdict }`, or 401, 403, 404 or 409 with the reason. A verdict in the request is ignored, so no gate credential has to leave the server for an agent's resolve to move the check.
