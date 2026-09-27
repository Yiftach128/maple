/**
 * The translation between Maple's vocabulary and jev's.
 *
 * Nothing here reaches a network. A pillar becomes a `score` question, the
 * kind and a mock's state become a `choice`, a call a mock concerns a `noul`,
 * and each answer's own probabilities become the distribution a surface
 * renders. `docs/assist.md` says why a distribution is carried, not a level.
 */

import {
  COMMENT_KIND_DESCRIPTIONS,
  COMMENT_KINDS,
  FALLBACK_KIND,
  MOCK_PLAN_STATE_DESCRIPTIONS,
  MOCK_PLAN_STATES,
  plannedCall,
  withoutLayers,
} from "@maple-kit/core/connectors";

import type {
  CommentKind,
  KindGuess,
  MockPlanRequest,
  MockPlanState,
  Pillar,
  PillarScore,
  PlannedCall,
  StateGuess,
} from "@maple-kit/core/connectors";

/** The key the kind question is asked and answered under. */
export const KIND_KEY = "kind";

/** The key one pillar is asked and answered under. */
export function pillarKey(pillar: Pillar): string {
  return `pillar:${pillar.id}`;
}

/** A jev question that picks one option from a described set. */
export interface ChoiceQuestion {
  readonly criteria: Readonly<Record<string, string>>;
  readonly instructions: string;
  readonly type: "choice";
}

/** A jev question that rates against ordered, described levels. */
export interface ScoreQuestion {
  readonly criteria: readonly string[];
  readonly instructions: string;
  readonly type: "score";
}

/** A jev question answered with one probability that it holds. */
export interface NoulQuestion {
  readonly criteria?: { readonly false: string; readonly true: string };
  readonly instructions: string;
  readonly type: "noul";
}

/** Any of them, in the shape the System One endpoint takes. */
export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

/** A jev answer, in the shape the System One endpoint returns. */
export interface Answer {
  readonly type: string;
  readonly choice?: string;
  readonly confidence?: number;
  readonly noul?: number;
  readonly probabilities?: Readonly<Record<string, number>>;
}

/**
 * Told to every question. Without the first half the model judges the reported
 * problem; without the second it marks a half-typed comment down for being one.
 */
const FRAMING =
  "Judge the review comment in `comment` on how it is written, not on whether what" +
  " it describes is a real problem. It may be half-written; judge what is there.";

/** What a request's `state` may hold: JSON, and nothing a model cannot read. */
export type Json =
  boolean | number | string | null | readonly Json[] | { readonly [key: string]: Json };

/** The `state` one request carries: the comment, and nothing else. */
export function stateFor(body: string): { readonly comment: string } {
  return { comment: body };
}

/** The key a mock's state is asked and answered under. */
export const PLAN_STATE_KEY = "state";

/** The key one call is asked about under: its index, since a key is any text. */
export function callKey(index: number): string {
  return `call:${index}`;
}

/**
 * What the sentence asks of the data, when it also names a listed role or
 * flag: the sentence less those, which the calls are judged on. Left in, a
 * role or a flag reads as the whole page, and every call came out concerned.
 */
export function planDataFor(request: MockPlanRequest): string | undefined {
  const data = withoutLayers(request.request, request.flags ?? [], request.roles ?? []);
  return data === request.request.trim() ? undefined : data;
}

/**
 * A mock request's `state`: the sentence, its route and the calls, as they
 * came, and its {@link planDataFor} where that differs. The state is judged
 * on the whole sentence: "no roasts yet" alone reads as not yet a state.
 */
export function planStateFor(request: MockPlanRequest): { readonly [key: string]: Json } {
  const data = planDataFor(request);
  return {
    request: request.request,
    ...(data === undefined ? {} : { data }),
    route: request.route,
    calls: request.calls.map(({ key, summary }) => ({ key, summary })),
  };
}

/** The state a mock request names, as a `choice` over every plan state. */
export function planStateQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "A reviewer typed `request` to see the page at `route` in some state of its" +
      " data; `calls` are the requests that page made. Which state does it ask for?" +
      " It may be half-typed; judge what is there.",
    criteria: Object.fromEntries(
      MOCK_PLAN_STATES.map((state) => [state, MOCK_PLAN_STATE_DESCRIPTIONS[state]]),
    ),
  };
}

/**
 * Whether the request concerns one call, as a `noul`: judged on `data` where
 * the state carries it, which is the request less its role and flags.
 */
export function callQuestion(index: number, key: string, data = false): NoulQuestion {
  const asked = data
    ? "the reviewer's `data`, the part of their `request` about the page's data,"
    : "the reviewer's `request`";
  return {
    type: "noul",
    instructions:
      `Does ${asked} concern \`calls[${index}]\` (${key})? A request` +
      " about the whole page concerns every call that reads data, and none that writes it." +
      " Who to see the page as, and a feature to turn on or off, concern no call.",
    criteria: {
      true: "The request asks for what this call returns to be some way, or for the whole page's data to be.",
      false:
        "The request is about other calls, names nothing this call returns, or only says who to see the page as or which feature to turn on or off.",
    },
  };
}

/** A `choice` answer over the plan states, as a guess. */
export function planStateFrom(answer: Answer): StateGuess {
  const shares = normalise(MOCK_PLAN_STATES.map((state) => at(answer.probabilities, state)));
  const distribution = {} as Record<MockPlanState, number>;
  MOCK_PLAN_STATES.forEach((state, index) => {
    distribution[state] = shares[index] ?? 0;
  });

  const chosen = MOCK_PLAN_STATES.find((state) => state === answer.choice);
  const state = chosen ?? MOCK_PLAN_STATES[argmax(shares)] ?? "none";
  return { state, distribution, confidence: clamp01(answer.confidence ?? concentration(shares)) };
}

/** A `noul` answer as a call's verdict. A missing probability is no evidence either way. */
export function plannedCallFrom(key: string, answer: Answer): PlannedCall {
  const p = typeof answer.noul === "number" && Number.isFinite(answer.noul) ? answer.noul : 0;
  return plannedCall(key, p);
}

/**
 * One pillar as a `score` question.
 *
 * The levels arrive already described as concrete situations, which is what
 * the primitive asks for, so the criteria are the pillar's own words.
 */
export function pillarQuestion(pillar: Pillar): ScoreQuestion {
  return {
    type: "score",
    instructions: `${pillar.instruction} ${FRAMING}`,
    criteria: pillar.levels.map((level) => `${level.label}. ${level.description}`),
  };
}

/** The kind as a `choice` question over the fixed vocabulary. */
export function kindQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "What kind of review comment is `comment`? Judge what its writer is doing" +
      " with it, not how well it is written.",
    criteria: Object.fromEntries(
      COMMENT_KINDS.map((kind) => [kind, COMMENT_KIND_DESCRIPTIONS[kind]]),
    ),
  };
}

/**
 * A `score` answer as a {@link PillarScore}.
 *
 * The probabilities are jev's own, keyed by level index. The level is the
 * rung that took the most of them rather than the weighted mean jev also
 * returns, because a level is an index into a ladder and not a position on it.
 */
export function pillarScoreFrom(pillar: Pillar, answer: Answer): PillarScore {
  const distribution = normalise(
    pillar.levels.map((_, index) => at(answer.probabilities, String(index))),
  );
  const level = argmax(distribution);

  return {
    pillar: pillar.id,
    level,
    distribution,
    confidence: clamp01(answer.confidence ?? concentration(distribution)),
  };
}

/** A `choice` answer as a {@link KindGuess}, over every kind Maple knows. */
export function kindGuessFrom(answer: Answer): KindGuess {
  const shares = normalise(COMMENT_KINDS.map((kind) => at(answer.probabilities, kind)));
  const distribution = {} as Record<CommentKind, number>;
  COMMENT_KINDS.forEach((kind, index) => {
    distribution[kind] = shares[index] ?? 0;
  });

  const chosen = COMMENT_KINDS.find((kind) => kind === answer.choice);
  const kind = chosen ?? COMMENT_KINDS[argmax(shares)] ?? FALLBACK_KIND;
  return { kind, distribution, confidence: clamp01(answer.confidence ?? concentration(shares)) };
}

function at(probabilities: Readonly<Record<string, number>> | undefined, key: string): number {
  const share = probabilities?.[key];
  return typeof share === "number" && Number.isFinite(share) ? Math.max(0, share) : 0;
}

/**
 * Scales shares to sum to one, spreading evenly when they sum to nothing. jev
 * rounds to two places; this corrects that, and the shape stays jev's.
 */
function normalise(shares: readonly number[]): number[] {
  const total = shares.reduce((sum, share) => sum + share, 0);
  if (total <= 0) return shares.map(() => 1 / shares.length);
  return shares.map((share) => share / total);
}

/** How concentrated a distribution is, on the scale jev reports confidence on. */
function concentration(distribution: readonly number[]): number {
  const count = distribution.length;
  if (count < 2) return 1;
  return clamp01((count * Math.max(...distribution) - 1) / (count - 1));
}

/** The first index holding the largest value, so ties go to the earlier rung. */
function argmax(values: readonly number[]): number {
  return values.reduce((best, value, index) => (value > (values[best] ?? 0) ? index : best), 0);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
