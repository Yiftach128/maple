---
"@maple-kit/core": patch
---

The Node route adapter (`toNodeMiddleware`, and so the Vite plugin) no longer crashes the server on an HTTP/2 request. It skips the pseudo-headers (`:method`, `:path`, `:scheme`, `:authority`) that `Headers` refuses, takes the host from `:authority` when there is no `host`, and builds the URL with the request's `:scheme`, so a gate published from a request served over HTTPS links back to `https://`. A handler that rejects now answers 500 instead of leaving an unhandled rejection that exits Node.
