---
"@maple-kit/mock": minor
"@maple-kit/core": minor
---

A GraphQL codec, on by default at `/graphql` and `/api/graphql`, and
anywhere else `graphqlCodec({ endpoint })` names. An operation is a call named
`graphql:GetProjects`; an anonymous one is keyed by a hash of its text, and a
persisted one by its id or, with `graphqlCodec({ manifest })`, by its
operation. A body state reshapes the `data` the page's own operation fetched,
and a failure is `data: null` beside `errors` at 200, the way a client reads
one. A response without `data` is never recorded and goes back as it came, so
APQ still works under a mock, and a partial one, `data` beside `errors`, is
reshaped but never recorded: an `Answer` may now be `partial`. `readGraphqlOperation` in `@maple-kit/core/mock`
computes the key.

A `Call` may say whether it `mutates`, and a write reaching the server under
`as` is reported by that rather than by the method when it does. The
interceptor says at `debug` why a call the recipe names went through
unmocked, through `ResolveOptions.onUnmocked`.
