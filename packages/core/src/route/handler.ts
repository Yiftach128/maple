/**
 * The SDK route: one handler the overlay talks to, mounted on the host
 * application's own origin.
 *
 * Same-origin is the whole design. It means no `connect-src` addition, and it
 * means the application's session cookie is already on the request, so
 * identity is a five-line function rather than a second login.
 */

import { MapleStoreError } from "../errors.js";
import { publishGate } from "../gate/publish.js";
import { fnv1a32 } from "../lib/fnv1a.js";
import { handleApprovals } from "./approvals.js";
import { createAssist } from "./assist.js";
import { endLink, finishLink, githubState, linkFailure, startLink } from "./auth.js";
import { gateFor } from "./gate.js";
import { createMockSchemas, MOCK_SCHEMA_KEYS, shapesFor } from "./mock.js";
import { createMockPlanner } from "./plan.js";
import { createRefreshAccess, handleRefresh } from "./refresh.js";

import type {
  GateConnector,
  IdentityConnector,
  IdentityRequest,
  ListQuery,
  MediaConnector,
} from "../connectors/types.js";
import type { Logger } from "../logger/types.js";
import type { CommentStore } from "../store.js";
import type {
  Comment,
  CommentAuthor,
  CommentResolution,
  CommentStatus,
  MapleUser,
  NewComment,
} from "../types.js";
import type { Assist, AssistOptions } from "./assist.js";
import type { GitHubAuthOptions } from "./auth.js";
import type { GateResolver } from "./gate.js";
import type { MockRouteOptions, MockSchemas } from "./mock.js";
import type { MockPlanner } from "./plan.js";
import type { PushAccess } from "./push-access.js";
import type { GateRefreshOptions } from "./refresh.js";

/**
 * Chooses the store for one request. The shape a per-reviewer credential
 * needs: the token differs per person, so the connector holding it does too.
 * Null means this reviewer has nowhere to write yet.
 */
export type StoreResolver = (
  request: IdentityRequest,
) => CommentStore | null | Promise<CommentStore | null>;

/**
 * Chooses the media connector for one request, for the same reason a store is
 * chosen per request: the credential can be the reviewer's.
 */
export type MediaResolver = (
  request: IdentityRequest,
) => MediaConnector | null | Promise<MediaConnector | null>;

/** What the route is wired to. */
export interface RouteOptions {
  /**
   * Where comments live: a `createCommentStore(connector)` or a resolver. Absent,
   * the comment and approval endpoints answer 404, for a host that only mocks.
   */
  readonly store?: CommentStore | StoreResolver;
  /**
   * Where screenshots go. Without one the overlay says a screenshot has
   * nowhere to be kept, rather than offering to take one and dropping it.
   */
  readonly media?: MediaConnector | MediaResolver;
  /** Resolves the reviewer from the request. Without one, comments are guest-written. */
  readonly identity?: IdentityConnector;
  /**
   * Where the merge verdict goes after a status changes. Without one a resolve
   * is recorded and nothing is reported.
   */
  readonly gate?: GateConnector | GateResolver;
  /**
   * Turns on `POST /gate/refresh`, which republishes the gate for a caller who
   * can push to this repository. Absent, it answers 404. Needs `gate`.
   */
  readonly gateRefresh?: GateRefreshOptions;
  /**
   * Signs a reviewer in to GitHub with Device Flow. Absent, the three
   * `/auth/github` endpoints answer 404 and `/me` reports no link state.
   */
  readonly githubAuth?: GitHubAuthOptions;
  /**
   * Judges the comment being typed. Absent, `/assist` answers 404 and nothing
   * about the composer changes: the whole tier is off unless switched on.
   */
  readonly assist?: AssistOptions;
  /**
   * True when a quiet surface still needs somebody to say they looked. Needs a
   * store that keeps approvals and an identity to name who left one.
   */
  readonly requireApproval?: boolean;
  /**
   * Maple Mock's `/mock/schema`, `/mock/plan` and `/mock/identity`, for a
   * preview that asked. Absent, or with `preview` false, each answers 404.
   */
  readonly mock?: MockRouteOptions;
  /** Defaults to `/api/maple`. */
  readonly basePath?: string;
  /** Where failures are reported. Silent when absent. */
  readonly logger?: Logger;
}

/** The default mount point, matched by the Vite plugin and the Next codemod. */
export const DEFAULT_BASE_PATH = "/api/maple";

const STATUSES = new Set<string>(["open", "resolved", "needs_reverify", "orphaned"]);

/**
 * Shape only: the client describes its own page here, as it already does the
 * branch and the URL, and a store finds the commit or says it cannot.
 */
const COMMIT = /^[0-9a-f]{7,40}$/;

/** The ten OKLCH reviewer hues a mark can be drawn in. */
const COLOR_SLOTS = 10;

/** Creates the request handler. Web-standard in, web-standard out. */
/** Everything built once, when the handler is, rather than per request. */
interface Mount {
  readonly options: RouteOptions;
  /** Undefined when no classifier is configured: the whole tier is off. */
  readonly assist: Assist | undefined;
  /** Undefined when the route serves no shapes. */
  readonly mock: MockSchemas | undefined;
  /** Undefined when nothing plans: no `mock.plan`, or a classifier without `plan`. */
  readonly planner: MockPlanner | undefined;
  /** Undefined when `gateRefresh` is not configured. */
  readonly refresh: PushAccess | undefined;
}

export function createMapleHandler(options: RouteOptions): (request: Request) => Promise<Response> {
  const base = options.basePath ?? DEFAULT_BASE_PATH;
  const mock = options.mock === undefined ? undefined : createMockSchemas(options.mock);
  const plan = options.mock?.plan;
  const mount: Mount = {
    options,
    assist: options.assist === undefined ? undefined : createAssist(options.assist),
    mock,
    planner: mock && plan ? createMockPlanner(plan, mock) : undefined,
    refresh:
      options.gateRefresh === undefined ? undefined : createRefreshAccess(options.gateRefresh),
  };

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : undefined;
    if (route === undefined) return json({ error: "Not found" }, 404);

    try {
      return await dispatch(mount, request, route, url);
    } catch (error) {
      return failure(options.logger, error);
    }
  };
}

/** The endpoints at one exact path, each with an arm of its own. */
const FIXED: ReadonlyMap<string, (mount: Mount, request: Request, url: URL) => Promise<Response>> =
  new Map([
    ["/assist", (mount, request) => judge(mount, request)],
    ["/mock/schema", (mount, request, url) => mockSchema(mount, request, url)],
    ["/mock/plan", (mount, request) => mockPlan(mount, request)],
    ["/mock/identity", (mount, request) => mockIdentity(mount, request)],
    ["/auth/github", (mount, request) => link(mount.options, request)],
    ["/gate/refresh", (mount, request) => refresh(mount, request)],
  ]);

async function dispatch(
  mount: Mount,
  request: Request,
  route: string,
  url: URL,
): Promise<Response> {
  const { options } = mount;
  const fixed = FIXED.get(route);
  if (fixed) return fixed(mount, request, url);
  if (route === "/media" || route.startsWith("/media/")) return media(options, request, route, url);
  if (route === "/approvals" || route.startsWith("/approvals/")) {
    return approvals(options, request, route, url);
  }

  const one = /^\/comments\/([^/]+)$/.exec(route);
  if (route !== "/comments" && route !== "/me" && !one) return json({ error: "Not found" }, 404);

  const allowed = methodAllowed(route, one !== null, request.method);
  if (!allowed) return json({ error: "Method not allowed" }, 405);
  if (route === "/me") return whoAmI(mount, request);
  if (options.store === undefined) return json({ error: "Not found" }, 404);

  const store = await storeFor(options, request);
  if (!store) return json({ error: "This reviewer has no store to write to" }, 401);

  if (one) return setStatus(options, store, request, one[1]!);
  return request.method === "GET"
    ? listComments(store, url)
    : appendComment(options, store, request);
}

/** The gate refresh arm: 404 unless it was switched on. */
async function refresh(mount: Mount, request: Request): Promise<Response> {
  const { options, refresh: access } = mount;
  if (options.gateRefresh === undefined || access === undefined) {
    return json({ error: "Not found" }, 404);
  }

  return handleRefresh(
    {
      access,
      options: options.gateRefresh,
      gate: () => gateFor(options.gate, identityRequest(request)),
      fallbackStore: () => storeFor(options, request),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      ...(options.requireApproval === undefined
        ? {}
        : { requireApproval: options.requireApproval }),
    },
    request,
  );
}

/**
 * The approval arm. It resolves its own reviewer as well as its store: an
 * approval is the one write whose author decides whether it is accepted.
 */
async function approvals(
  options: RouteOptions,
  request: Request,
  route: string,
  url: URL,
): Promise<Response> {
  if (options.store === undefined) return json({ error: "Not found" }, 404);
  const store = await storeFor(options, request);
  if (!store) return json({ error: "This reviewer has no store to write to" }, 401);

  const id = route === "/approvals" ? undefined : decodeURIComponent(route.slice(11));
  const user = (await options.identity?.resolveUser(identityRequest(request))) ?? null;
  const answer = await handleApprovals({ store, user, authorFor }, request, id, url);

  const branch = request.method === "GET" ? undefined : await branchOf(answer);
  if (branch !== undefined) await reportGate(options, store, request, branch);
  return answer;
}

/**
 * The branch a write was about, off the answer rather than the request: a
 * `DELETE` names an id. Undefined when nothing was written, so no publish.
 */
async function branchOf(answer: Response): Promise<string | undefined> {
  if (answer.status !== 200 && answer.status !== 201) return undefined;

  const body = (await answer.clone().json()) as { branch?: unknown };
  return typeof body.branch === "string" ? body.branch : undefined;
}

/** `POST /media` takes the bytes and hands back the reference a comment keeps;
 * `GET /media/{key}` redirects to wherever the connector put them. */
async function media(
  options: RouteOptions,
  request: Request,
  route: string,
  url: URL,
): Promise<Response> {
  const connector = await mediaFor(options, request);
  if (!connector) return json({ error: "This deployment keeps no screenshots" }, 404);

  const key = route === "/media" ? undefined : decodeURIComponent(route.slice("/media/".length));
  if (key === undefined) {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    return putBlob(connector, request);
  }

  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  return readBlob(connector, key, url);
}

/** The content type is the request's, so nothing has to be parsed out of bytes. */
async function putBlob(connector: MediaConnector, request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return json({ error: "An image is required" }, 415);

  const data = new Uint8Array(await request.arrayBuffer());
  if (data.byteLength === 0) return json({ error: "An image is required" }, 400);

  return json(await connector.putBlob({ data, contentType }), 201);
}

/** A redirect, not a proxy: a connector's URL is signed and short-lived, and
 * streaming the bytes would put every screenshot on the application's budget. */
async function readBlob(connector: MediaConnector, key: string, url: URL): Promise<Response> {
  const contentType = url.searchParams.get("type") ?? "application/octet-stream";
  const found = await connector.getUrl({ connector: connector.name, key, contentType });
  const inline = decoded(found);
  if (inline) return inline;

  return new Response(null, {
    status: 302,
    headers: { location: found, "cache-control": "no-store" },
  });
}

/** A browser refuses to follow a redirect to a data URL, so a connector that
 * answers with one is served rather than pointed at. Only a dev one does. */
function decoded(found: string): Response | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(found);
  if (!match) return undefined;

  const binary = atob(match[2]!);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": match[1]!, "cache-control": "no-store" },
  });
}

/** A plain connector is used as it is; a resolver is asked, every request. */
async function mediaFor(options: RouteOptions, request: Request): Promise<MediaConnector | null> {
  const chosen = options.media;
  if (chosen === undefined) return null;
  return typeof chosen === "function" ? chosen(identityRequest(request)) : chosen;
}

/**
 * Starting, finishing and forgetting a GitHub link. Neither the device code
 * nor the token reaches the browser: both travel in cookies this route sets.
 */
async function link(options: RouteOptions, request: Request): Promise<Response> {
  const auth = options.githubAuth;
  if (!auth) return json({ error: "Not found" }, 404);

  const headers = Object.fromEntries(request.headers);
  try {
    if (request.method === "POST") return await startLink(auth);
    if (request.method === "PATCH") return await finishLink(auth, headers);
    if (request.method === "DELETE") return endLink(auth);
    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    return linkFailure(error) ?? failure(options.logger, error);
  }
}

/** Checked before the store is resolved: a wrong method is not a credential problem. */
function methodAllowed(route: string, one: boolean, method: string): boolean {
  if (one) return method === "PATCH";
  if (route === "/me") return method === "GET";
  return method === "GET" || method === "POST";
}

/** A plain connector is used as it is; a resolver is asked, every request. */
async function storeFor(options: RouteOptions, request: Request): Promise<CommentStore | null> {
  const { store } = options;
  if (store === undefined) return null;
  return typeof store === "function" ? store(identityRequest(request)) : store;
}

async function listComments(store: CommentStore, url: URL): Promise<Response> {
  const branch = url.searchParams.get("branch");
  if (!branch) return json({ error: "A branch is required" }, 400);

  const page = await store.list(queryFrom(url, branch));
  return json(page, 200);
}

function queryFrom(url: URL, branch: string): ListQuery {
  const cursor = url.searchParams.get("cursor");
  const limit = url.searchParams.get("limit");
  const statuses = url.searchParams.getAll("status").filter((value) => STATUSES.has(value));

  return {
    branch,
    ...(cursor === null ? {} : { cursor }),
    ...(limit === null ? {} : { limit: Number(limit) }),
    ...(statuses.length === 0 ? {} : { statuses: statuses as CommentStatus[] }),
  };
}

/**
 * The author and their colour slot are built here, never read off the body: a
 * client that can choose its own author can choose someone else's.
 */
/**
 * One comment, or a whole set published at once. A store that can take a batch
 * in one write posts one notification rather than one per comment.
 */
async function appendComment(
  options: RouteOptions,
  store: CommentStore,
  request: Request,
): Promise<Response> {
  const posted = await readJson(request);
  const batch = Array.isArray(posted) ? posted : undefined;
  const drafts: unknown[] = batch ?? [posted];

  if (drafts.length === 0) return json({ comments: [] }, 201);
  if (!drafts.every(isDraft)) return json({ error: "A branch and a body are required" }, 400);

  const user = await options.identity?.resolveUser(identityRequest(request));
  const author = user ? authorFor(user) : GUEST;
  const comments: NewComment[] = drafts.map((draft) => ({
    ...withoutResolution(draft),
    author,
  }));

  const stored = await store.appendMany(comments);
  const branch = stored[0]?.branch;
  if (branch !== undefined) await reportGate(options, store, request, branch);

  return json(batch ? { comments: stored } : stored[0], 201);
}

/** The author Maple records when no identity connector named one. */
const GUEST = { id: "guest", name: "Guest", provenance: "guest" } as const;

/** A resolved reviewer, as a comment or an approval records them. */
function authorFor(user: MapleUser): CommentAuthor {
  return {
    id: user.id,
    name: user.name,
    provenance: "server",
    colorSlot: colorSlotFor(user.id),
    ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
  };
}

/**
 * A hash of the id rather than a per-page counter: two reviewers on two
 * machines would otherwise be handed the same hue and read as one person.
 */
function colorSlotFor(id: string): number {
  return fnv1a32(id) % COLOR_SLOTS;
}

async function setStatus(
  options: RouteOptions,
  store: CommentStore,
  request: Request,
  id: string,
): Promise<Response> {
  const change = (await readJson(request)) as
    { status?: unknown; resolution?: unknown } | undefined;
  const status = change?.status;
  if (typeof status !== "string" || !STATUSES.has(status)) {
    return json({ error: "An known status is required" }, 400);
  }

  const claimed = change?.resolution;
  if (claimed !== undefined && !isResolutionClaim(claimed)) {
    return json({ error: "A resolution needs a sha" }, 400);
  }

  const resolution = claimed === undefined ? undefined : stamp(claimed);
  const updated = await store.setStatus(id, status as CommentStatus, resolution);
  if (!updated) return json({ error: "This store cannot change a status" }, 501);

  await reportGate(options, store, request, updated.branch);
  return json(updated, 200);
}

/**
 * Awaited, not left floating: a serverless runtime may stop the process as the
 * response is written, and `publishGate` never throws.
 */
async function reportGate(
  options: RouteOptions,
  store: CommentStore,
  request: Request,
  branch: string,
): Promise<void> {
  const gate = await gateFor(options.gate, identityRequest(request));
  if (!gate) return;

  const context = {
    store,
    gate,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.requireApproval === undefined ? {} : { requireApproval: options.requireApproval }),
  };
  await publishGate(context, branch, new URL(request.url).origin);
}

/** What a client may claim about a resolution: the commit, and optionally why. */
function isResolutionClaim(value: unknown): value is { sha: string; note?: string } {
  if (typeof value !== "object" || value === null) return false;
  const claim = value as { sha?: unknown; note?: unknown };
  return (
    typeof claim.sha === "string" &&
    claim.sha.length > 0 &&
    (claim.note === undefined || typeof claim.note === "string")
  );
}

/**
 * `at` is stamped here, never taken from the body, for the same reason the
 * author is: a client that can date its own resolution can backdate one.
 */
function stamp(claim: { sha: string; note?: string }): CommentResolution {
  return {
    sha: claim.sha,
    ...(claim.note === undefined ? {} : { note: claim.note }),
    at: new Date().toISOString(),
  };
}

async function whoAmI(mount: Mount, request: Request): Promise<Response> {
  const { assist, options } = mount;
  const user = await options.identity?.resolveUser(identityRequest(request));
  const auth = options.githubAuth;
  const github = auth ? await githubState(auth, Object.fromEntries(request.headers)) : undefined;
  const media = (await mediaFor(options, request)) !== null;

  return json(
    {
      user: user ?? null,
      media,
      approval: { required: options.requireApproval === true },
      ...(github === undefined ? {} : { github }),
      ...(assist === undefined ? {} : { assist: { pillars: assist.pillars } }),
    },
    200,
  );
}

/**
 * `/me` says whether the gate wants an approval, never whether one could be
 * left: answering that means resolving a store. `GET /approvals` answers that.
 */

/**
 * The comment being typed, judged. The session it is counted against is the
 * reviewer's own id, so one person's typing cannot spend another's budget.
 */
async function judge(mount: Mount, request: Request): Promise<Response> {
  const { assist, options } = mount;
  if (!assist) return json({ error: "Not found" }, 404);

  const user = await options.identity?.resolveUser(identityRequest(request));
  return assist.respond(request, user?.id ?? "anonymous", options.logger);
}

/**
 * Shapes for the keys asked about. Only on a preview that switched it on, and
 * only to a reviewer the identity connector resolves, when there is one.
 */
async function mockSchema(mount: Mount, request: Request, url: URL): Promise<Response> {
  const { mock, options } = mount;
  if (mock === undefined || !mock.preview) return json({ error: "Not found" }, 404);
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  if (options.identity !== undefined) {
    const user = await options.identity.resolveUser(identityRequest(request));
    if (user === null) return json({ error: "Sign in to read shapes" }, 401);
  }
  const keys = url.searchParams.getAll("key");
  if (keys.length === 0 || keys.length > MOCK_SCHEMA_KEYS) {
    return json({ error: `Ask for between 1 and ${MOCK_SCHEMA_KEYS} keys` }, 400);
  }
  return json({ shapes: await shapesFor(mock, keys) }, 200);
}

/** The host's identity rules, gated as the shapes are. */
async function mockIdentity(mount: Mount, request: Request): Promise<Response> {
  const { mock, options } = mount;
  const identity = mock?.preview === true ? await mock.identity() : undefined;
  if (identity === undefined) return json({ error: "Not found" }, 404);
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  if (options.identity !== undefined) {
    const user = await options.identity.resolveUser(identityRequest(request));
    if (user === null) return json({ error: "Sign in to read identity rules" }, 401);
  }
  return json({ identity }, 200);
}

/**
 * A sentence, planned. Gated as the shapes are, and counted against the
 * reviewer's own id, so one person's typing cannot spend another's budget.
 */
async function mockPlan(mount: Mount, request: Request): Promise<Response> {
  const { mock, options, planner } = mount;
  if (mock === undefined || !mock.preview || planner === undefined) {
    return json({ error: "Not found" }, 404);
  }

  const user = await options.identity?.resolveUser(identityRequest(request));
  if (options.identity !== undefined && user === null) {
    return json({ error: "Sign in to plan a mock" }, 401);
  }
  return planner.respond(request, user?.id ?? "anonymous", options.logger);
}

/** The identity connector sees headers and a URL, and nothing else. */
function identityRequest(request: Request): { headers: Record<string, string>; url: string } {
  return { headers: Object.fromEntries(request.headers), url: request.url };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * A comment cannot arrive already resolved, and dropping it here beats widening
 * `NewComment`'s `Omit`, which would hide the field from stores too.
 */
function withoutResolution<T extends { resolution?: unknown }>(draft: T): Omit<T, "resolution"> {
  const copy = { ...draft };
  delete copy.resolution;
  return copy;
}

function isDraft(value: unknown): value is Omit<NewComment, "author"> & { author?: never } {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Partial<Comment>;
  return (
    typeof draft.branch === "string" &&
    typeof draft.body === "string" &&
    !!draft.anchor &&
    (draft.label === undefined || typeof draft.label === "string") &&
    (draft.commit === undefined || COMMIT.test(draft.commit))
  );
}

/**
 * A connector's message goes to the log, not to the browser. It can name a
 * repository, a rate limit or a token that is about to expire.
 */
function failure(logger: Logger | undefined, error: unknown): Response {
  logger?.error(
    "The Maple route failed.",
    error instanceof Error ? error : new Error(String(error)),
  );

  if (error instanceof MapleStoreError && error.reason === "unavailable") {
    return json({ error: "The store could not be reached" }, 503);
  }
  if (error instanceof MapleStoreError || error instanceof RangeError) {
    return json({ error: "The request was not valid for this store" }, 400);
  }
  return json({ error: "Something went wrong" }, 500);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
