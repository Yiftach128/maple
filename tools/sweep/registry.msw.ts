/**
 * A fake npm registry's dist-tags endpoint. It answers each name with the
 * latest version a test set, a 404 for a name it does not know, and a 500 for
 * a name a test marked as failing.
 */

import { http, HttpResponse } from "msw";

export const REGISTRY = "https://registry.example.test";

/** Handlers for a registry whose `latest` tags are `tags`; names in `failing` answer 500. */
export function registryHandlers(
  tags: Readonly<Record<string, string>>,
  failing: readonly string[] = [],
) {
  return [
    http.get(`${REGISTRY}/-/package/*`, ({ request }) => {
      const path = new URL(request.url).pathname;
      const name = decodeURIComponent(path.slice("/-/package/".length, -"/dist-tags".length));
      if (failing.includes(name)) return HttpResponse.json({ error: "down" }, { status: 500 });
      const latest = tags[name];
      if (latest === undefined) return HttpResponse.json({ error: "Not found" }, { status: 404 });
      return HttpResponse.json({ latest, next: `${latest}-next.0` });
    }),
  ];
}
