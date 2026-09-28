/**
 * The seam between a wire protocol and everything else in this package.
 *
 * A codec turns one HTTP exchange into logical calls and back. Everything a
 * protocol does differently, a batch or an error envelope, stays inside it,
 * so resolving, recording and transforming never look at a URL or a header.
 */

import type { TypeMeta } from "./superjson.js";

/** One logical call inside a request. */
export interface Call {
  /** The stable key a recipe names it by, prefixed with the codec's name. */
  readonly key: string;
  /**
   * Whether the call writes, when the protocol says so: a GraphQL mutation
   * is one over any method. Absent, the HTTP method decides.
   */
  readonly mutates?: boolean;
}

/**
 * What one call answered, or is to answer. `meta` is present when the body
 * travels in superjson's envelope, and says what its annotations are.
 */
export type Answer =
  | {
      readonly kind: "data";
      readonly status: number;
      readonly body: unknown;
      readonly meta?: TypeMeta;
      /** The server answered in part, with errors beside it: reshaped, never recorded. */
      readonly partial?: boolean;
    }
  | {
      readonly kind: "failure";
      readonly state: "error" | "forbidden";
      readonly meta?: TypeMeta;
    };

/** A wire protocol Maple can take apart and put back together. */
export interface Codec {
  readonly name: string;
  /** The request as it is sent on when its response will be rewritten. */
  prepare?(request: Request): Request;
  /**
   * The calls `request` carries, or undefined when this codec does not own it.
   * A request it owns with no call it can name is `[]`, and passes through.
   */
  split(request: Request): Promise<readonly Call[] | undefined>;
  /** A real response as one answer per call, or undefined when it cannot be read. */
  read(response: Response, calls: readonly Call[]): Promise<readonly Answer[] | undefined>;
  /**
   * One response carrying `answers` in call order. `real` is the server's own
   * response when one was fetched, for the headers worth keeping.
   */
  join(calls: readonly Call[], answers: readonly Answer[], real?: Response): Response;
}

/** A 2xx data answer: the only kind worth recording or reshaping. */
export function isData(answer: Answer | undefined): answer is Extract<Answer, { kind: "data" }> {
  return answer?.kind === "data" && answer.status >= 200 && answer.status < 300;
}

const DROPPED = ["content-encoding", "content-length", "transfer-encoding"];

/** The real response's headers, less the ones a rewritten body invalidates. */
export function keptHeaders(real: Response | undefined, type: string): Headers {
  const headers = new Headers(real?.headers);
  for (const name of DROPPED) headers.delete(name);
  headers.set("content-type", type);
  return headers;
}
