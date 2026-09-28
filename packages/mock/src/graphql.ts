/**
 * The GraphQL codec: one request is one operation, `graphql:GetProjects`.
 *
 * The page's own operation runs on the server, and its `data` is what a
 * state reshapes, so an answer matches the selection set exactly. A failure
 * is written as a GraphQL server writes one, `data: null` beside `errors`
 * at 200, which is where a client's error path listens. A response without
 * `data` is not an answer: never recorded, and sent back as it came.
 */

import { readGraphqlOperation } from "@maple-kit/core/mock";

import { isData, keptHeaders } from "./codec.js";
import { isJson } from "./rest.js";

import type { Answer, Call, Codec } from "./codec.js";
import type { GraphqlParams } from "@maple-kit/core/mock";

/** How the codec finds GraphQL requests and names the persisted ones. */
export interface GraphqlCodecOptions {
  /**
   * Where the GraphQL handler is mounted, one path or several. Defaults to
   * `/graphql` and `/api/graphql`, where a Next app mounts it.
   */
  readonly endpoint?: string | readonly string[];
  /**
   * The host's persisted documents, id to text, as graphql-codegen's
   * `persistedDocuments` writes them: a persisted request is then named by its operation.
   */
  readonly manifest?: Readonly<Record<string, string>>;
}

const GRAPHQL_RESPONSE = "application/graphql-response+json";

const ENDPOINTS = ["/graphql", "/api/graphql"];

const FAILURES = {
  error: { message: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" },
  forbidden: { message: "Forbidden", code: "FORBIDDEN" },
} as const;

/**
 * A GraphQL codec. Put it before the REST codec, which claims everything. It
 * owns every request at its endpoints: one it cannot name, a batch or a body
 * that is not JSON, has no call in it and passes through, never reaching REST.
 */
export function graphqlCodec(options: GraphqlCodecOptions = {}): Codec {
  const endpoints = new Set([options.endpoint ?? ENDPOINTS].flat().map(trimSlash));
  const manifest = new Map(Object.entries(options.manifest ?? {}));

  async function split(request: Request): Promise<Call[] | undefined> {
    if (!endpoints.has(trimSlash(new URL(request.url).pathname))) return undefined;
    const params = await paramsOf(request);
    const operation = params && readGraphqlOperation(withText(params, manifest));
    if (operation === undefined) return [];
    const { key, type } = operation;
    return [{ key, ...(type === undefined ? {} : { mutates: type === "mutation" }) }];
  }

  return { name: "graphql", split, read, join };
}

function trimSlash(path: string): string {
  return path.replace(/\/$/, "");
}

/** A persisted request's text, from the manifest, when it carries none of its own. */
function withText(params: GraphqlParams, manifest: ReadonlyMap<string, string>): GraphqlParams {
  const text = params.query ? undefined : manifest.get(params.documentId ?? "");
  return text === undefined ? params : { ...params, query: text };
}

/** The request parameters, from the query string or the JSON body. A batch is not read. */
async function paramsOf(request: Request): Promise<GraphqlParams | undefined> {
  if (request.method === "GET") return fromSearch(new URL(request.url).searchParams);
  if (request.method !== "POST" || !isJson(request.headers.get("content-type"))) return undefined;
  const body: unknown = await request.json().catch(() => undefined);
  return isRecord(body) ? fromBody(body) : undefined;
}

function fromSearch(search: URLSearchParams): GraphqlParams {
  return {
    operationName: search.get("operationName"),
    query: search.get("query"),
    documentId:
      search.get("documentId") ?? persistedHash(parseJson(search.get("extensions"))) ?? null,
  };
}

function fromBody(body: Record<string, unknown>): GraphqlParams {
  return {
    operationName: asString(body["operationName"]) ?? null,
    query: asString(body["query"]) ?? null,
    documentId: asString(body["documentId"]) ?? persistedHash(body["extensions"]) ?? null,
  };
}

/** APQ's id, `extensions.persistedQuery.sha256Hash`, when the request carries one. */
function persistedHash(extensions: unknown): string | undefined {
  if (!isRecord(extensions) || !isRecord(extensions["persistedQuery"])) return undefined;
  return asString(extensions["persistedQuery"]["sha256Hash"]);
}

/**
 * A response with `data` is one answer, the data alone, partial beside `errors`.
 * Without it, it is an error read at the server's status, or 500 for a 2xx.
 */
async function read(response: Response): Promise<readonly Answer[] | undefined> {
  if (!isJson(response.headers.get("content-type"))) return undefined;
  const text = await response.text();
  const envelope = parseJson(text);
  if (!isRecord(envelope)) return undefined;
  const data = envelope["data"];
  if (data !== undefined && data !== null) {
    const partial = Array.isArray(envelope["errors"]) && envelope["errors"].length > 0;
    return [{ kind: "data", status: response.status, body: data, ...(partial ? { partial } : {}) }];
  }
  return [{ kind: "data", status: response.ok ? 500 : response.status, body: envelope }];
}

function join(_: readonly Call[], answers: readonly Answer[], real?: Response): Response {
  const answer = answers[0];
  const headers = keptHeaders(
    real,
    essence(real) === GRAPHQL_RESPONSE ? GRAPHQL_RESPONSE : "application/json",
  );
  if (answer === undefined || answer.kind === "failure") {
    const failure = FAILURES[answer?.state ?? "error"];
    const errors = [{ message: failure.message, extensions: { code: failure.code } }];
    return new Response(JSON.stringify({ data: null, errors }), { status: 200, headers });
  }
  const { body, status } = answer;
  if (isData(answer)) return new Response(JSON.stringify({ data: body }), { status, headers });
  return new Response(JSON.stringify(body), { status: real?.status ?? status, headers });
}

function essence(response: Response | undefined): string {
  return (response?.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function parseJson(text: string | null): unknown {
  try {
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
