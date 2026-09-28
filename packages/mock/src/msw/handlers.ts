/**
 * The same resolver as the in-page transport, as MSW request handlers.
 *
 * For a host that already runs MSW (Storybook, Vitest, Playwright) and would
 * rather its worker or server did the intercepting. The recipe comes from the
 * caller: nobody types into a test, so it is a file, a link or a literal.
 */

import { bypass, http } from "msw";

import { graphqlCodec } from "../graphql.js";
import { createInventory } from "../inventory.js";
import { resolve } from "../resolve.js";
import { pathPattern, restCodec } from "../rest.js";
import { trpcCodec } from "../trpc.js";

import type { Codec } from "../codec.js";
import type { Inventory } from "../inventory.js";
import type { Recipe } from "@maple-kit/core/mock";
import type { RequestHandler } from "msw";

/** How {@link mockHandlers} resolves. Every field has a working default. */
export interface MockHandlerOptions {
  /** Tried in order. Defaults to tRPC at `/api/trpc`, GraphQL at `/graphql` and `/api/graphql`, then REST. */
  readonly codecs?: readonly Codec[];
  /** Where real answers are recorded. Defaults to a fresh one in memory. */
  readonly inventory?: Inventory;
  /** The page's route pattern. Defaults to the location's, or `/` without one. */
  readonly route?: () => string;
  /** Sends a request past MSW. Defaults to `fetch(bypass(request))`. */
  readonly fetch?: (request: Request) => Promise<Response>;
}

/**
 * One handler that answers the calls `recipe` names and falls through for the
 * rest, so the host's own handlers after it still answer them. Put it first.
 */
export function mockHandlers(
  recipe: Recipe | undefined,
  options: MockHandlerOptions = {},
): RequestHandler[] {
  const inventory = options.inventory ?? createInventory();
  const codecs = options.codecs ?? [trpcCodec(), graphqlCodec(), restCodec];
  const forward = options.fetch ?? ((request: Request) => fetch(bypass(request)));
  const route =
    options.route ?? (() => pathPattern(typeof location === "undefined" ? "/" : location.pathname));

  return [
    http.all("*", ({ request }) =>
      resolve(request, recipe, inventory, { codecs, forward, route: route() }),
    ),
  ];
}
