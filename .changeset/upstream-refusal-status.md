---
"@maple-kit/core": patch
---

The route no longer blames the browser when GitHub refuses Maple's own call. A GitHub 401, 403 or 404 on a store call (bad or missing token, an App without permission, a repository or pull request it cannot see) now answers 502 with "GitHub refused the request (403): ..." instead of 400 "not valid for this store". Other rejections still answer 400. `MapleStoreError` gains `upstream`, and a connector can throw the new exported `UpstreamError` to get the same treatment.
