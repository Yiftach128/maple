/**
 * A System One endpoint that plans the Vite example's page as jev did, live:
 * each call's `noul` is what jev answered for the text that call was judged
 * on, rounded. Keyed by that text, so the same sentence judged whole reads
 * the way it did before a role and flag were taken out of it.
 */

import { http, HttpResponse } from "msw";

import type { RequestHandler } from "msw";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** The page's calls, in the order the recorded answers are in. */
export const PAGE_CALLS = [
  { key: "rest:GET /api/session", summary: "name, tint, role, permissions" },
  { key: "rest:GET /api/audit", summary: "items [AuditEvent: id, who, what, when]" },
  {
    key: "rest:GET /api/reviews",
    summary: "items [Review: id, repo, branch, open, state, reviewer, tint], total, nextCursor",
  },
] as const;

/** Each call's `noul`, by the text it was judged on. A role or flag left in reads as the page. */
const CONCERNS: Readonly<Record<string, readonly number[]>> = {
  "as a member, with the merge forecast on": [0.78, 0.73, 0.76],
  "show the reviews table empty": [0.11, 0.19, 0.94],
  "as a member with the merge forecast on, and the reviews table empty": [0.76, 0.77, 0.84],
  "": [0.23, 0.25, 0.42],
  "the reviews table empty": [0.06, 0.06, 0.96],
};

/** The state each sentence was read as, and the flag and role it was read to set. */
const READINGS: Readonly<Record<string, { state: string; flag: string; role: string }>> = {
  "as a member, with the merge forecast on": { state: "none", flag: "on", role: "member" },
  "show the reviews table empty": {
    state: "empty",
    flag: "leave-unchanged",
    role: "no-role-named",
  },
  "as a member with the merge forecast on, and the reviews table empty": {
    state: "empty",
    flag: "on",
    role: "member",
  },
};

interface Asked {
  readonly questions: Record<string, { type: string; instructions: string; criteria: object }>;
  readonly state: { readonly request: string; readonly data?: string };
}

/** The recorded endpoint. A sentence it has no recording for is answered 500. */
export function recordedPlanner(url = ENDPOINT): RequestHandler[] {
  return [
    http.post(url, async ({ request }) => {
      const asked = (await request.json()) as Asked;
      const reading = READINGS[asked.state.request];
      if (reading === undefined) return HttpResponse.json({ detail: "boom" }, { status: 500 });

      const answers: Record<string, unknown> = {};
      for (const [key, question] of Object.entries(asked.questions)) {
        const answer = answerTo(key, question, asked.state, reading);
        if (answer === undefined) return HttpResponse.json({ detail: "boom" }, { status: 500 });
        answers[key] = answer;
      }
      return HttpResponse.json({ model: "jev-1.13.0", answers, usage: {} });
    }),
  ];
}

function answerTo(
  key: string,
  question: Asked["questions"][string],
  state: Asked["state"],
  reading: { state: string; flag: string; role: string },
): unknown {
  if (question.type === "noul") {
    const judged = question.instructions.includes("`data`") ? state.data : state.request;
    const concerns = CONCERNS[judged ?? state.request];
    const noul = concerns?.[Number(key.split(":")[1])];
    return noul === undefined ? undefined : { type: "noul", noul };
  }
  const chosen = { state: reading.state, role: reading.role }[key] ?? reading.flag;
  const options = Object.keys(question.criteria);
  const probabilities = Object.fromEntries(
    options.map((option) => [option, option === chosen ? 0.96 : 0.04 / (options.length - 1)]),
  );
  return { type: "choice", choice: chosen, confidence: 0.95, probabilities };
}
