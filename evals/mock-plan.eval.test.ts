/**
 * Does planning a mock with a model beat planning it with a word list?
 *
 * Each case pairs a reviewer's sentence with the calls a page made, and is
 * scored on the state meant, the calls it concerns (F1), and, on a page with
 * flags or roles, whether the flags and role it sets are exactly the ones
 * meant. cases/mock-plan says where every case and inventory came from.
 */

import { readFileSync } from "node:fs";

import { jevClassifier } from "@maple-kit/classifier";
import { keywordClassifier } from "@maple-kit/core/connectors";
import { describe, expect, it } from "vitest";

import type {
  ClassifierConnector,
  MockPlan,
  MockPlanCall,
  MockPlanFlag,
  MockPlanState,
} from "@maple-kit/core/connectors";
import type { FlagValue } from "@maple-kit/core/mock";

/** A page's calls, as the route hands them to a planner. */
interface Inventory {
  readonly source: "recorded" | "written";
  readonly route: string;
  readonly calls: readonly MockPlanCall[];
  /** The flags the page evaluated, as the box lists them to the route. */
  readonly flags?: readonly MockPlanFlag[];
  /** The roles the host's identity rules list. */
  readonly roles?: readonly string[];
}

/** One sentence, and the answers a reader would not argue with. */
interface Case {
  readonly id: string;
  readonly by: "agent" | "maintainer" | "reviewer";
  /**
   * `layers` for a case written for flags and roles, `values` for one written
   * for `long`, `sparse` and `mixed`; absent, the data set.
   */
  readonly set?: "layers" | "values";
  readonly inventory: string;
  readonly request: string;
  readonly state: MockPlanState;
  /** The calls it must concern. Absent: the calls are not scored. */
  readonly calls?: readonly string[];
  /** Calls a reader could argue either way, scored neither way. */
  readonly maybe?: readonly string[];
  /** The flags it sets, on a page with flags. Absent: none. */
  readonly flags?: Readonly<Record<string, FlagValue>>;
  /** The role it asks to be shown as, on a page with roles. Absent: none. */
  readonly as?: string;
}

function read<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./cases/mock-plan/${name}`, import.meta.url), "utf8"),
  ) as T;
}

const INVENTORIES = read<Readonly<Record<string, Inventory>>>("inventories.json");
const CASES = read<readonly Case[]>("cases.json");

/**
 * Per set, measured rather than chosen, each just under what was measured;
 * the README's table has the numbers. Raised, never lowered.
 */
const THRESHOLDS = {
  keyword: {
    data: { state: 0.9, calls: 0.68, layers: 0.95 },
    layers: { state: 0.97, calls: 0.72, layers: 0.83 },
    values: { state: 0.94, calls: 0.61, layers: 0.99 },
  },
  model: {
    data: { state: 0.92, calls: 0.86, layers: 0.97 },
    layers: { state: 0.88, calls: 0.93, layers: 0.9 },
    values: { state: 0.87, calls: 0.9, layers: 0.9 },
  },
} satisfies Record<string, Record<CaseSet, Report>>;

/** The cases a threshold is measured over. */
type CaseSet = "data" | "layers" | "values";

const ids = process.env["EVAL_IDS"]?.split(",").map((id) => id.trim());
const chosen = ids === undefined ? CASES : CASES.filter((one) => ids.includes(one.id));
const samples = Math.max(1, Number(process.env["EVAL_SAMPLES"] ?? "1"));

/** A tier's score over a set: state accuracy, mean call F1, and layer accuracy. */
interface Report {
  readonly state: number;
  readonly calls: number;
  readonly layers: number;
}

async function score(connector: ClassifierConnector): Promise<Record<CaseSet, Report>> {
  const runs = Array.from({ length: samples }, () => chosen).flat();
  const results = await pooled(runs, (one) => judge(connector, one));
  const of = (set: CaseSet) =>
    report(
      connector.name,
      set,
      results.filter((one) => (one.set ?? "data") === set),
    );
  return { data: of("data"), layers: of("layers"), values: of("values") };
}

function report(name: string, set: CaseSet, results: readonly Scored[]): Report {
  if (process.env["EVAL_VERBOSE"] !== undefined) {
    const missed = (key: "layers" | "state") =>
      [...new Set(results.filter((one) => one[key] === 0).map((one) => one.id))].join(", ");
    process.stdout.write(`${name} ${set} state misses: ${missed("state")}\n`);
    process.stdout.write(`${name} ${set} layer misses: ${missed("layers")}\n`);
  }
  const scored = (key: "calls" | "layers") =>
    results.flatMap((one) => (one[key] === undefined ? [] : [one[key]]));
  return {
    state: mean(results.map((result) => result.state)),
    calls: mean(scored("calls")),
    layers: mean(scored("layers")),
  };
}

/** How many plans are in flight at once: a model with two requests a plan drops a flood. */
const IN_FLIGHT = 16;

/** Runs `work` over every item with at most {@link IN_FLIGHT} running, results in order. */
async function pooled<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let at = next++; at < items.length; at = next++) results[at] = await work(items[at]!);
  };
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, items.length) }, worker));
  return results;
}

interface Scored {
  readonly id: string;
  readonly set?: "layers" | "values";
  readonly state: number;
  readonly calls?: number;
  readonly layers?: number;
}

async function judge(connector: ClassifierConnector, one: Case): Promise<Scored> {
  const inventory = INVENTORIES[one.inventory];
  if (inventory === undefined) throw new Error(`${one.id}: no inventory "${one.inventory}"`);
  const { calls, flags, roles, route } = inventory;
  const plan = await connector.plan?.({
    request: one.request,
    route,
    calls,
    ...(flags === undefined ? {} : { flags }),
    ...(roles === undefined ? {} : { roles }),
  });
  if (plan === undefined) throw new Error(`${connector.name} does not plan`);

  const state = plan.state === one.state ? 1 : 0;
  const tag = one.set === undefined ? {} : { set: one.set };
  const layered = flags !== undefined || roles !== undefined;
  const layers = layered ? { layers: sameLayers(plan, one) ? 1 : 0 } : {};
  if (one.calls === undefined || one.state === "none") {
    return { id: one.id, ...tag, state, ...layers };
  }

  const maybe = new Set(one.maybe ?? []);
  const chosenCalls = plan.calls.filter((call) => call.concerned && !maybe.has(call.key));
  const f = f1(new Set(chosenCalls.map((call) => call.key)), one.calls);
  return { id: one.id, ...tag, state, calls: f, ...layers };
}

/** Exactly the flags, at exactly the values, and the role the case means: nothing more. */
function sameLayers(plan: MockPlan, one: Case): boolean {
  const set = (plan.flags ?? []).filter((flag) => flag.concerned);
  const flags = Object.fromEntries(set.map((flag) => [flag.key, flag.value]));
  const role = plan.role !== undefined && plan.role.p >= 0.5 ? plan.role.role : undefined;
  return (
    JSON.stringify(sorted(flags)) === JSON.stringify(sorted(one.flags ?? {})) && role === one.as
  );
}

function sorted(record: Readonly<Record<string, FlagValue>>): [string, FlagValue][] {
  return Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b));
}

/** Both empty is a perfect score: the case says no call, and none was chosen. */
function f1(chosenKeys: ReadonlySet<string>, meant: readonly string[]): number {
  if (chosenKeys.size === 0 && meant.length === 0) return 1;
  const hit = meant.filter((key) => chosenKeys.has(key)).length;
  return (2 * hit) / (chosenKeys.size + meant.length);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 1 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";

const SETS: readonly CaseSet[] = ["data", "layers", "values"];

/** A set with no case chosen scores one everywhere, so a narrowed run never fails on it. */
function expectAtLeast(report: Report, floor: Report): void {
  expect(report.state).toBeGreaterThanOrEqual(floor.state);
  expect(report.calls).toBeGreaterThanOrEqual(floor.calls);
  expect(report.layers).toBeGreaterThanOrEqual(floor.layers);
}

describe("mock plan · the keyword planner", () => {
  it(`is the floor every model has to clear (${String(chosen.length)} cases)`, async () => {
    const reports = await score(keywordClassifier());
    if (process.env["EVAL_VERBOSE"] !== undefined)
      process.stdout.write(`keyword ${JSON.stringify(reports)}\n`);

    for (const set of SETS) expectAtLeast(reports[set], THRESHOLDS.keyword[set]);
  });
});

/** Skipped rather than failed without a credential, as the assist eval is. */
describe.skipIf(apiKey === "")("mock plan · the model tier", () => {
  it("clears its thresholds on each set, and beats the word list where it should", async () => {
    const model = process.env["MAPLE_AI_MODEL"];
    const jev = jevClassifier({ apiKey, ...(model === undefined ? {} : { model }) });

    const [tier, floor] = await Promise.all([score(jev), score(keywordClassifier())]);
    if (process.env["EVAL_VERBOSE"] !== undefined)
      process.stdout.write(`jev ${JSON.stringify(tier)}\n`);

    for (const set of SETS) expectAtLeast(tier[set], THRESHOLDS.model[set]);
    // On the data set it beats the word list at both; on the layers set, at the
    // layers; on the values set, whose word list was tuned on it, at the calls.
    expect(tier.data.state).toBeGreaterThan(floor.data.state);
    expect(tier.data.calls).toBeGreaterThan(floor.data.calls);
    expect(tier.layers.layers).toBeGreaterThan(floor.layers.layers);
    expect(tier.values.calls).toBeGreaterThan(floor.values.calls);
  }, 180_000);
});
