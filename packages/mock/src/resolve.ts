/**
 * Deciding what one intercepted request answers, under a recipe.
 *
 * A call the recipe does not name keeps the server's answer. A body state
 * reshapes the server's own answer, so it is as fresh as the page; a failure
 * or a hold needs nothing from the server, and nothing is sent for it.
 */

import { isData } from "./codec.js";
import { impose, meetsNeed, realIdentity } from "./identity.js";
import { sampleSchema } from "./schema/sample.js";
import { deflate } from "./superjson.js";
import { reshape, reshapeTyped } from "./transform.js";

import type { Answer, Call, Codec } from "./codec.js";
import type { Inventory, Sample } from "./inventory.js";
import type { ShapeLookup } from "./schema/shape.js";
import type { BodyState } from "./transform.js";
import type { IdentityRules, MockIdentity, MockState, Recipe, Shape } from "@maple-kit/core/mock";

/** What {@link resolve} needs besides the request. */
export interface ResolveOptions {
  /** Tried in order; the first to claim a request owns it. */
  readonly codecs: readonly Codec[];
  /** Sends a request to the real server, past the interceptor. */
  readonly forward: (request: Request) => Promise<Response>;
  /** The page's route pattern, which the inventory is scoped to. */
  readonly route: string;
  /** Milliseconds since the epoch, for a recorded sample. */
  readonly now?: () => number;
  /** Each call's response schema, which bounds a reshape and answers a call never seen. */
  readonly shape?: ShapeLookup;
  /** The host's identity rules, which a recipe's `as` is applied through. */
  readonly identity?: IdentityRules;
  /** Told of each call a write sends to the server while a recipe's `as` is on. */
  readonly onWrite?: (key: string) => void;
  /** Told why a request, or a call the recipe gives a state, went through unmocked. */
  readonly onUnmocked?: (unmocked: Unmocked) => void;
}

/** Why a request, or one call in it, went through unmocked while a recipe applied. */
export interface Unmocked {
  /** The name of the codec that owns the request. */
  readonly codec: string;
  /** The call, absent when the codec could name none in the request. */
  readonly key?: string;
  /**
   * `no call`: nothing in the request could be named. `unreadable`: the response
   * could not be read. `nothing to reshape`: no data came, and no sample or shape.
   */
  readonly reason: "no call" | "unreadable" | "nothing to reshape";
  /** The server's HTTP status, when it was asked. */
  readonly status?: number;
}

/** A request taken apart: its codec, its calls, and each call's state. */
export interface Split {
  readonly codec: Codec;
  readonly calls: readonly Call[];
  readonly states: readonly (MockState | undefined)[];
}

const BODY_STATES: ReadonlySet<MockState> = new Set<MockState>([
  "empty",
  "many",
  "one",
  "long",
  "sparse",
  "mixed",
]);

/** The request's calls and the state the recipe gives each, or undefined when no codec owns it. */
export async function splitRequest(
  request: Request,
  recipe: Recipe | undefined,
  codecs: readonly Codec[],
): Promise<Split | undefined> {
  for (const codec of codecs) {
    const calls = await codec.split(request.clone());
    if (calls === undefined) continue;
    const states = calls.map(
      (call) => recipe?.calls.find((named) => named.key === call.key)?.state,
    );
    return { codec, calls, states };
  }
  return undefined;
}

/**
 * The response `request` gets under `recipe`, or undefined to let it through
 * untouched. A `loading` call holds the whole response until the request is
 * abandoned, since one HTTP response cannot arrive in part.
 */
export async function resolve(
  request: Request,
  recipe: Recipe | undefined,
  inventory: Inventory,
  options: ResolveOptions,
): Promise<Response | undefined> {
  const applies = recipe?.route === undefined || recipe.route === options.route;
  const active = applies ? recipe : undefined;
  const taken = await splitRequest(request, active, options.codecs);
  if (taken === undefined) return undefined;
  if (active !== undefined && taken.calls.length === 0) {
    options.onUnmocked?.({ codec: taken.codec.name, reason: "no call" });
  }
  const layer = identityLayer(active?.as, options.identity);
  const split = layer === undefined ? taken : withNeeds(taken, layer, inventory, options.route);
  if (layer !== undefined) tellWrites(split, request.method, options.onWrite);
  const imposed = split.calls.map((call) => call.key === layer?.rules.call);
  const untouched = split.states.every((state) => state === undefined);
  if (untouched && !imposed.includes(true)) return undefined;
  if (split.states.includes("loading")) return hold(request);

  const needsServer = split.states.some((state) => state === undefined || BODY_STATES.has(state));
  const sent = split.codec.prepare?.(request) ?? request;
  const real = needsServer ? await options.forward(sent) : undefined;
  const live = real === undefined ? undefined : await split.codec.read(real.clone(), split.calls);
  if (real !== undefined && live === undefined) {
    tellUnmocked(split, "unreadable", real, options.onUnmocked);
    return real;
  }

  record(inventory, split.calls, live, options);
  const shapes = await shapesOf(split, options.shape);
  const answers = split.calls.map((call, index) => {
    const one = answer(
      split.states[index],
      live?.[index],
      inventory.sample(call.key, options.route),
      shapes[index],
    );
    return imposed[index] && layer !== undefined ? withIdentity(one, layer) : one;
  });
  const states = split.states.map((state, index) => kept(state, answers[index]));
  tellUnmocked({ ...split, states }, "nothing to reshape", real, options.onUnmocked);
  return split.codec.join(split.calls, answers, real);
}

/** `as`, and the rules it is applied through: both, or no layer at all. */
interface IdentityLayer {
  readonly as: MockIdentity;
  readonly rules: IdentityRules;
}

const WRITES = /^(?:POST|PUT|PATCH|DELETE)$/i;

function identityLayer(as?: MockIdentity, rules?: IdentityRules): IdentityLayer | undefined {
  return as === undefined || rules === undefined ? undefined : { as, rules };
}

/**
 * Each call the shown identity may not make answers 403, unless the recipe
 * names it. The real identity is the one the identity call last answered.
 */
function withNeeds(split: Split, layer: IdentityLayer, inventory: Inventory, route: string): Split {
  const sample = inventory.sample(layer.rules.call, route);
  const real = sample === undefined ? {} : realIdentity(sample.body, layer.rules);
  const states = split.calls.map((call, index) => {
    const named = split.states[index];
    if (named !== undefined) return named;
    return meetsNeed(call.key, layer.as, layer.rules, real) ? undefined : "forbidden";
  });
  return { ...split, states };
}

/**
 * A write that reaches the server under `as` still acts as the reviewer: say
 * so. A call that says whether it writes is believed over the method.
 */
function tellWrites(split: Split, method: string, onWrite: ResolveOptions["onWrite"]): void {
  split.calls.forEach((call, index) => {
    const state = split.states[index];
    const writes = call.mutates ?? WRITES.test(method);
    if (writes && (state === undefined || BODY_STATES.has(state))) onWrite?.(call.key);
  });
}

/** Tells of each call that has a state, for `reason`, with the server's status. */
function tellUnmocked(
  split: Split,
  reason: Unmocked["reason"],
  real: Response | undefined,
  onUnmocked: ResolveOptions["onUnmocked"],
): void {
  const status = real === undefined ? {} : { status: real.status };
  split.calls.forEach((call, index) => {
    if (split.states[index] === undefined) return;
    onUnmocked?.({ codec: split.codec.name, key: call.key, reason, ...status });
  });
}

/** The body state that kept the server's answer, having nothing to reshape. */
function kept(state: MockState | undefined, answer: Answer | undefined): MockState | undefined {
  return state !== undefined && BODY_STATES.has(state) && !isData(answer) ? state : undefined;
}

function withIdentity(answer: Answer, layer: IdentityLayer): Answer {
  return isData(answer) ? { ...answer, body: impose(answer.body, layer.as, layer.rules) } : answer;
}

/** Records every real, whole 2xx answer. A mocked or partial one is never recorded. */
export function record(
  inventory: Inventory,
  calls: readonly Call[],
  answers: readonly Answer[] | undefined,
  options: Pick<ResolveOptions, "now" | "route">,
): void {
  const at = (options.now ?? Date.now)();
  calls.forEach((call, index) => {
    const answer = answers?.[index];
    if (!isData(answer) || answer.partial === true) return;
    const { body, meta, status } = answer;
    inventory.record(options.route, { key: call.key, status, body, at, ...(meta ? { meta } : {}) });
  });
}

/** The shapes of the calls a body state reshapes. Nothing is looked up for the rest. */
async function shapesOf(split: Split, lookup: ShapeLookup | undefined) {
  return Promise.all(
    split.calls.map((call, index) => {
      const state = split.states[index];
      const wanted = lookup !== undefined && state !== undefined && BODY_STATES.has(state);
      return Promise.resolve(wanted ? lookup(call.key) : undefined);
    }),
  );
}

/**
 * One call's answer. A failure borrows the envelope the call was last seen in,
 * so a superjson client can read a failure nothing was fetched for.
 */
function answer(
  state: MockState | undefined,
  live: Answer | undefined,
  sample?: Sample,
  shape?: Shape,
): Answer {
  if (state === "error" || state === "forbidden") {
    const meta = live?.meta ?? sample?.meta;
    const enveloped = meta !== undefined || shape?.superjson === true;
    return { kind: "failure", state, ...(enveloped ? { meta: {} } : {}) };
  }
  if (state === undefined || !BODY_STATES.has(state)) return live ?? failure();
  const source = isData(live) ? live : (sample ?? sampled(shape));
  if (source === undefined) return live ?? failure();
  const schema = shape?.schema;
  if (source.meta === undefined) {
    return { kind: "data", status: 200, body: reshape(state as BodyState, source.body, schema) };
  }
  return {
    kind: "data",
    status: 200,
    ...reshapeTyped(state as BodyState, source.body, source.meta, schema),
  };
}

/** A body for a call nothing has answered, drawn from its schema alone. */
function sampled(shape: Shape | undefined): Pick<Sample, "body" | "meta"> | undefined {
  if (shape === undefined) return undefined;
  const value = sampleSchema(shape.schema, { superjson: shape.superjson === true });
  return shape.superjson === true ? deflate(value) : { body: value };
}

function failure(): Answer {
  return { kind: "failure", state: "error" };
}

/**
 * Held requests, kept reachable: Node links a request's signal to the caller's
 * weakly, so a collected one never hears the abort.
 */
// eslint-disable-next-line sonarjs/no-unused-collection -- holding the reference is the point.
const HELD = new Set<Request>();

/**
 * Settles only when the request is abandoned. The signal may already have
 * aborted while the request was being taken apart, and fires no event then.
 */
function hold(request: Request): Promise<never> {
  const { signal } = request;
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  HELD.add(request);
  return new Promise((_, reject) => {
    const release = () => {
      HELD.delete(request);
      reject(signal.reason as Error);
    };
    signal.addEventListener("abort", release, { once: true });
  });
}
