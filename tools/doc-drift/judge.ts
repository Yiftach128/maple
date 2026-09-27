/**
 * Asks jev whether a change made a paragraph false. One request per
 * candidate carries two questions over the same state: a `noul` for whether
 * the paragraph is stale, and a `choice` for how. Plain `fetch` against the
 * System One endpoint, so this runs on Node's builtins with no install.
 */

import type { Candidate } from "./candidates.ts";
import type { Hunk } from "./diff.ts";

/** What a change did to what a paragraph states. */
export const REASONS = {
  renamed:
    "The change removes or renames something the paragraph names: a variable, option, argument, function, file, entry or command.",
  behaviour:
    "The change alters a behaviour, default, count, list or location the paragraph describes, so the description no longer holds.",
  consistent: "The paragraph already describes the code as the change leaves it.",
  unrelated: "The change does not touch anything the paragraph states.",
} as const;

/** One of {@link REASONS}. */
export type Reason = keyof typeof REASONS;

/** jev's judgement of one candidate. */
export interface Verdict {
  readonly reason: Reason;
  /** The probability that the paragraph is false once the change lands. */
  readonly stale: number;
}

/** What one request is asked about: the paragraph and the hunks, as text. */
export interface DriftState {
  readonly [key: string]: unknown;
  readonly change: readonly { readonly diff: string; readonly file: string }[];
  readonly paragraph: { readonly file: string; readonly text: string };
}

/** Past this a hunk is cut: a paragraph is decided by a few lines, not a rewrite. */
const MAX_HUNK_LINES = 60;
const MAX_HUNKS = 4;

/** The state for one paragraph and the hunks that reach it. */
export function stateFor(file: string, text: string, hunks: readonly Hunk[]): DriftState {
  return {
    paragraph: { file, text },
    change: hunks.slice(0, MAX_HUNKS).map((hunk) => ({
      file: hunk.file,
      diff: [hunk.header, ...hunk.lines.slice(0, MAX_HUNK_LINES)].join("\n"),
    })),
  };
}

/** The two questions, asked of every candidate. */
export const QUESTIONS = {
  stale: {
    type: "noul",
    instructions:
      "`paragraph.text` is prose from the documentation file `paragraph.file`. Each entry in" +
      " `change` is a hunk of a code diff: a line starting with `-` is removed, `+` is added," +
      " and a space is unchanged context. Once this change lands, does the paragraph state" +
      " something that is no longer true of the code?",
    criteria: {
      true: "Something the paragraph states is false after the change: it names what the change removed or renamed, or describes behaviour, a default, a count or a location the change altered.",
      false:
        "Everything the paragraph states still holds after the change: it already matches the added lines, or the change does not touch what it states.",
    },
  },
  reason: {
    type: "choice",
    instructions:
      "What does the code change in `change` do to what `paragraph.text` states? Lines starting" +
      " with `-` are removed and lines starting with `+` are added.",
    criteria: REASONS,
  },
} as const;

/** How the judge reaches System One. */
export interface JudgeOptions {
  readonly apiKey: string;
  /** Defaults to TypeSafe's own API root. */
  readonly baseUrl?: string | undefined;
  /** Replaced in tests. Defaults to the global. */
  readonly fetch?: typeof fetch;
  /** Defaults to the flagship alias. */
  readonly model?: string | undefined;
  /** How long to wait after a 429 or 529 before the next attempt, doubled each time. */
  readonly retryMs?: number;
}

/** A request System One did not answer. */
export class DriftRequestError extends Error {
  override readonly name = "DriftRequestError";
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`System One answered ${String(status)}: ${detail}`);
    this.status = status;
  }
}

const ATTEMPTS = 3;
const TIMEOUT_MS = 30_000;
const RETRIED = new Set([429, 529]);

/** Builds the judge. Nothing is requested until a candidate is judged. */
export function createJudge(options: JudgeOptions): (state: DriftState) => Promise<Verdict> {
  const send = options.fetch ?? fetch;
  const url = `${(options.baseUrl ?? "https://api.typesafe.ai/v1").replace(/\/$/, "")}/systemone`;
  const body = (state: DriftState) =>
    JSON.stringify({ model: options.model ?? "jev-latest", questions: QUESTIONS, state });

  return async (state) => {
    for (let attempt = 1; ; attempt++) {
      const response = await send(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: body(state),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return verdictFrom((await response.json()) as SystemOneResponse);
      if (!RETRIED.has(response.status) || attempt === ATTEMPTS) {
        throw new DriftRequestError(response.status, await response.text());
      }
      await sleep((options.retryMs ?? 1000) * 2 ** (attempt - 1));
    }
  };
}

/** The judge's state for a candidate. */
export function candidateState(candidate: Candidate): DriftState {
  return stateFor(candidate.paragraph.file, candidate.paragraph.text, candidate.hunks);
}

interface SystemOneResponse {
  readonly answers?: {
    readonly reason?: { readonly choice?: string };
    readonly stale?: { readonly noul?: number };
  };
}

/** A missing answer is a broken provider, not a paragraph that could not be judged. */
export function verdictFrom(response: SystemOneResponse): Verdict {
  const stale = response.answers?.stale?.noul;
  const choice = response.answers?.reason?.choice;
  if (typeof stale !== "number" || !Number.isFinite(stale)) {
    throw new Error("System One returned no probability for `stale`.");
  }
  const reason = Object.keys(REASONS).find((key): key is Reason => key === choice);
  if (reason === undefined) throw new Error(`System One returned no known reason: ${choice}.`);
  return { reason, stale: Math.min(1, Math.max(0, stale)) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
