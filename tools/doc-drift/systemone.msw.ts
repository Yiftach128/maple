/**
 * A fake of the System One endpoint the judge calls, recording what it was
 * asked. It answers `stale` with the probability a test queued, or fails the
 * next requests with a status, so retries and failures can be counted.
 */

import { http, HttpResponse } from "msw";

import type { RequestHandler } from "msw";

export const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** One request, as the fake recorded it. */
export interface Asked {
  readonly authorization: string | null;
  readonly body: { model: string; questions: Record<string, { type: string }>; state: unknown };
}

/** The fake, and what it was asked. */
export interface SystemOneFake {
  readonly asked: Asked[];
  /** Fails the next `times` requests with `status`. */
  failNext(status: number, times?: number): void;
  readonly handlers: RequestHandler[];
  /** The answer to the next requests; defaults to 0.9 and `renamed`. */
  answer(stale: number, reason?: string): void;
  reset(): void;
}

export function createSystemOneFake(): SystemOneFake {
  const asked: Asked[] = [];
  let failing = { status: 0, times: 0 };
  let next = { reason: "renamed", stale: 0.9 };
  const handlers = [
    http.post(ENDPOINT, async ({ request }) => {
      const body = (await request.json()) as Asked["body"];
      asked.push({ authorization: request.headers.get("authorization"), body });
      if (failing.times > 0) {
        failing = { ...failing, times: failing.times - 1 };
        return HttpResponse.json({ detail: "refused" }, { status: failing.status });
      }
      return HttpResponse.json({
        model: "jev-1.13.0",
        answers: {
          stale: { type: "noul", noul: next.stale },
          reason: { type: "choice", choice: next.reason, confidence: 0.8, probabilities: {} },
        },
        usage: { input_tokens: 400, output_tokens: 8 },
      });
    }),
  ];
  return {
    answer(stale, reason = "renamed") {
      next = { reason, stale };
    },
    asked,
    failNext(status, times = 1) {
      failing = { status, times };
    },
    handlers,
    reset() {
      asked.length = 0;
      failing = { status: 0, times: 0 };
      next = { reason: "renamed", stale: 0.9 };
    },
  };
}
