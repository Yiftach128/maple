/**
 * Maple Mock's runtime: the page's API responses, rewritten into a state.
 *
 * Nothing here uses React, Effect or a model. `@maple-kit/mock/install` is the
 * one-line install; this entry has the same interceptor with options, and the
 * pieces a box or a test uses: the recipe, the inventory, the codecs.
 */

export {
  createMockClient,
  installedMock,
  MockClipboardError,
  PLAN_DEBOUNCE_MS,
  PLAN_MIN_LENGTH,
  planCall,
} from "./client/index.js";
export type {
  MockCallRow,
  MockClient,
  MockClientOptions,
  MockClientState,
  MockView,
} from "./client/index.js";
export { isData } from "./codec.js";
export type { Answer, Call, Codec } from "./codec.js";
export { flagType, holdStreams } from "./flag-source.js";
export type { FlagSource, Flags, FlagStream } from "./flag-source.js";
export { seenFlags } from "./flags.js";
export type { FlagRegistry, SeenFlag } from "./flags.js";
export { graphqlCodec } from "./graphql.js";
export type { GraphqlCodecOptions } from "./graphql.js";
export { impose, meetsNeed, realIdentity } from "./identity.js";
export type { RealIdentity } from "./identity.js";
export { installMock } from "./interceptor.js";
export type { InstallOptions, MockHandle } from "./interceptor.js";
export { createInventory, INVENTORY_STORAGE_KEY } from "./inventory.js";

export type { Inventory, InventoryLimits, InventoryOptions, Sample } from "./inventory.js";
export { forgetRecipe, RECIPE_STORAGE_KEY, readRecipe, saveRecipe } from "./link.js";
export type { RecipeSources } from "./link.js";
export { resolve } from "./resolve.js";
export type { ResolveOptions, Unmocked } from "./resolve.js";
export { isJson, pathPattern, restCodec, restKey } from "./rest.js";
export { routeIdentity } from "./schema/identity.js";
export type { RouteIdentityOptions } from "./schema/identity.js";
export {
  allowsNull,
  arrayOf,
  branches,
  deref,
  enumOf,
  properties,
  property,
  requiredOf,
  typesOf,
  valueBranch,
} from "./schema/json-schema.js";
export type { Located } from "./schema/json-schema.js";
export { PlanUnavailableError, routePlan } from "./schema/plan.js";
export type { PlanLookup, RoutePlanOptions } from "./schema/plan.js";
export { routeShapes } from "./schema/route.js";
export type { RouteShapesOptions } from "./schema/route.js";
export { sampleSchema } from "./schema/sample.js";
export type { SampleOptions } from "./schema/sample.js";
export type { ShapeLookup } from "./schema/shape.js";
export { annotate, deflate, inflate, isWrapped, prefixMeta, extractMeta } from "./superjson.js";
export type { TypeMeta } from "./superjson.js";
export { MANY, reshape, reshapeTyped } from "./transform.js";
export type { BodyState } from "./transform.js";
export { trpcCodec } from "./trpc.js";
export type { TrpcCodecOptions } from "./trpc.js";
export type { WriteLog } from "./writes.js";
