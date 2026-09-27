/**
 * The jev classifier: Maple's assist tier backed by a System One model.
 *
 * One request carries every pillar's question and the kind's together, and a
 * mock's state and every call's together, which is what makes judging as it
 * is typed affordable at all. jev reads the state once, answers in parallel.
 */

import { DEFAULT_PILLARS, selectPillars } from "@maple-kit/core/connectors";

import { openSystemOne } from "./internal/systemone.js";
import { hasLayers, layerQuestions, layersFrom, layerStateFor } from "./plan-layers.js";
import {
  callKey,
  callQuestion,
  KIND_KEY,
  kindGuessFrom,
  kindQuestion,
  pillarKey,
  pillarQuestion,
  pillarScoreFrom,
  PLAN_STATE_KEY,
  planDataFor,
  plannedCallFrom,
  planStateFor,
  planStateFrom,
  planStateQuestion,
  stateFor,
} from "./questions.js";

import type { Answer, Question } from "./questions.js";
import type {
  ClassifierConnector,
  ClassifierRequest,
  KindGuess,
  MockPlan,
  MockPlanRequest,
  Pillar,
  PillarScore,
  ScoreRequest,
} from "@maple-kit/core/connectors";

/** How a deployment reaches a System One model. */
export interface JevClassifierOptions {
  /** Read on the server, never in a browser. `docs/assist.md` says why. */
  readonly apiKey: string;
  /**
   * The API root `/systemone` is appended to, defaulting to TypeSafe's own.
   * Request-compatible reimplementations make local a configuration choice.
   */
  readonly baseUrl?: string | undefined;
  /** An alias or a pinned version. Defaults to the flagship alias. */
  readonly model?: string | undefined;
  /** What to judge against. Defaults to Maple's five. */
  readonly pillars?: readonly Pillar[] | undefined;
  /** How long one judgement may take before it is abandoned. Defaults to 8 s. */
  readonly timeoutMs?: number | undefined;
}

/** The alias, not a pinned version: `typesafe/jev-1.13` is another listing's id. */
const DEFAULT_MODEL = "jev-latest";

/** Past this a keystroke's judgement is stale: the next one is on its way. */
const DEFAULT_TIMEOUT_MS = 8000;

/** Builds the connector. Nothing is requested until something is scored. */
export function jevClassifier(options: JevClassifierOptions): ClassifierConnector {
  const pillars = options.pillars ?? DEFAULT_PILLARS;
  const connector: ClassifierConnector = {
    name: "jev",
    pillars,

    async classify(request: ClassifierRequest): Promise<KindGuess> {
      const answers = await ask(connector, "classify", request, { [KIND_KEY]: kindQuestion() });
      return kindGuessFrom(answerAt(answers, KIND_KEY));
    },

    async score(request: ScoreRequest): Promise<readonly PillarScore[]> {
      const asked = selectPillars(connector, request.pillars);
      const questions: Record<string, Question> = {};
      for (const pillar of asked) questions[pillarKey(pillar)] = pillarQuestion(pillar);

      const answers = await ask(connector, "score", request, questions);
      return asked.map((pillar) => pillarScoreFrom(pillar, answerAt(answers, pillarKey(pillar))));
    },

    async plan(request: MockPlanRequest): Promise<MockPlan> {
      const questions: Record<string, Question> = { [PLAN_STATE_KEY]: planStateQuestion() };
      const data = planDataFor(request) !== undefined;
      request.calls.forEach((call, index) => {
        questions[callKey(index)] = callQuestion(index, call.key, data);
      });

      const asked = { connector: connector.name, signal: request.signal };
      const [answers, layers] = await Promise.all([
        open().ask({ ...asked, operation: "plan", questions, state: planStateFor(request) }),
        hasLayers(request)
          ? open().ask({
              ...asked,
              operation: "plan-layers",
              questions: layerQuestions(request),
              state: layerStateFor(request),
            })
          : undefined,
      ]);
      return {
        ...planStateFrom(answerAt(answers, PLAN_STATE_KEY)),
        calls: request.calls.map((call, index) =>
          plannedCallFrom(call.key, answerAt(answers, callKey(index))),
        ),
        ...(layers === undefined ? {} : layersFrom(request, layers)),
      };
    },
  };

  const open = once(() =>
    openSystemOne({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model ?? DEFAULT_MODEL,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }),
  );

  /** Sends one question map and hands back the answers, keyed as they were asked. */
  function ask(
    self: ClassifierConnector,
    operation: string,
    request: ClassifierRequest,
    questions: Readonly<Record<string, Question>>,
  ): Promise<Readonly<Record<string, Answer>>> {
    return open().ask({
      connector: self.name,
      operation,
      questions,
      signal: request.signal,
      state: stateFor(request.body),
    });
  }

  return connector;
}

/**
 * An answer that must be there: a missing key means a broken provider rather
 * than a comment that could not be judged.
 */
function answerAt(answers: Readonly<Record<string, Answer>>, key: string): Answer {
  const answer = answers[key];
  if (answer === undefined) throw new Error(`jev returned no answer for "${key}".`);
  return answer;
}

/** Defers the first call and reuses its result, so a connector costs nothing unused. */
function once<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}
