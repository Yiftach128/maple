/**
 * The contract `@maple-kit/mock` and the comment fence share.
 *
 * The recipe and a call's shape live here: the route serves shapes and the
 * page reads them. The interceptor, the codecs and the transforms are in
 * `@maple-kit/mock`, which a host installs only when it mocks.
 */

export { activeRecipe, MOCK_HANDLE_KEY } from "./active.js";
export { readGraphqlOperation } from "./graphql.js";
export type { GraphqlOperation, GraphqlOperationType, GraphqlParams } from "./graphql.js";
export { identityRules, isIdentityRules } from "./identity.js";
export type { CallNeed, IdentityField, IdentityRules, IdentitySource } from "./identity.js";
export {
  decodeRecipe,
  encodeRecipe,
  linkRecipe,
  readRecipeCookie,
  RECIPE_COOKIE,
  RECIPE_COOKIE_LIMIT,
  RECIPE_PARAM,
  recipeCookie,
} from "./link.js";
export { PLAN_FLOOR, PLAN_TIE, readPlan } from "./reading.js";

export type { MockSuggestion, PlanReading } from "./reading.js";
export {
  describeIdentity,
  InvalidRecipeError,
  MOCK_STATES,
  parseRecipe,
  RECIPE_VERSION,
} from "./recipe.js";
export type { FlagValue, MockCall, MockIdentity, MockState, Recipe } from "./recipe.js";
export {
  createShapeIndex,
  isShape,
  MOCK_EXTENSION,
  readSchemaDocument,
  SHAPE_SOURCES,
} from "./shape.js";
export type { JsonSchema, SchemaDocument, Shape, ShapeIndex, ShapeSource } from "./shape.js";
