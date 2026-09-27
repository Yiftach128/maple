/**
 * The one route Maple asks an application to mount.
 *
 * It is deliberately web-standard — a `Request` in, a `Response` out — so the
 * same handler serves a Next route handler, a Vite middleware, Hono, Express
 * through an adapter, and a Worker.
 */

export type { AssistAnswer, AssistOptions } from "./assist.js";
export type { GitHubAuthOptions, GitHubState } from "./auth.js";
export type { RateLimit } from "./budget.js";
export type { GateResolver } from "./gate.js";
export { createMapleHandler, DEFAULT_BASE_PATH } from "./handler.js";
export type { MediaResolver, RouteOptions, StoreResolver } from "./handler.js";

export { MOCK_SCHEMA_KEYS } from "./mock.js";

export type { MockRouteOptions } from "./mock.js";
export { toNodeMiddleware } from "./node.js";

export type { NodeMiddleware } from "./node.js";
export type { MockPlanAnswer, MockPlanOptions } from "./plan.js";
export type { GateRefreshOptions } from "./refresh.js";
