---
"@maple-kit/core": patch
---

The GitHub store now resolves a head branch to its open pull request, even when a newer pull request on the same head is closed, such as a duplicate that was opened and closed. A closed or merged pull request is used only when none on the head is open, and then the most recently updated one.
