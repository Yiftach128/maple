/**
 * A small GraphQL server for a page to query, and a count of what reached it.
 *
 * It follows GraphQL over HTTP rather than any library: it reads the request
 * parameters from the body or the query string, answers `{ data }` or
 * `{ errors }`, and keeps APQ's hash-to-text store. What it answers is
 * chosen by the operation's first root field, so no fixture here is written
 * by the codec under test.
 */

import { http, HttpResponse } from "msw";

import type { RequestHandler } from "msw";

export const ORIGIN = "https://preview.example";
export const GRAPHQL = `${ORIGIN}/graphql`;
/** Where a Next app mounts the same handler. */
export const API_GRAPHQL = `${ORIGIN}/api/graphql`;
export const GRAPHQL_RESPONSE = "application/graphql-response+json";

export const PROJECTS = {
  projects: {
    items: [
      { id: "1", name: "Atlas" },
      { id: "2", name: "Borealis" },
    ],
    total: 2,
  },
};
export const ME = { me: { id: "u_1", name: "Reviewer" } };
export const CREATED = { createProject: { id: "3", name: "Cirrus" } };

export const QUERIES = {
  projects: "query Projects($first: Int) { projects(first: $first) { items { id name } total } }",
  me: "{ me { id name } }",
  create: "mutation CreateProject($name: String!) { createProject(name: $name) { id name } }",
};

/** The sha256 of `QUERIES.projects`, as APQ sends it. The fake refuses a hash that is not its text's. */
export const PROJECTS_HASH = "174dd2ef4c9300e7d79b2cbb4d2c73228c3bd15b4916b7ab0f5cb335f8203bac";

const ROOTS: Readonly<Record<string, unknown>> = {
  projects: PROJECTS,
  me: ME,
  createProject: CREATED,
};

export const NOT_FOUND = {
  errors: [
    { message: "PersistedQueryNotFound", extensions: { code: "PERSISTED_QUERY_NOT_FOUND" } },
  ],
};

/** Apollo Server's answer, at 400, to an APQ hash that is not its text's. */
export const MISMATCH = {
  errors: [
    {
      message: "provided sha does not match query",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    },
  ],
};

/** A fake GraphQL server, plus what it was asked. */
export interface GraphqlFake {
  readonly handlers: RequestHandler[];
  /** `METHOD field` of every operation that reached it, or `METHOD #id` for a miss or a refused hash. */
  readonly reached: readonly string[];
  /** Answers the operation on `field` with `data: null` and an error until reset. */
  fail(field: string): void;
  /** Answers `field` itself as null beside an error, as a nullable field that threw does. */
  failPartly(field: string): void;
  /** Forgets every persisted query and every failure. */
  reset(): void;
}

interface Params {
  readonly query?: string;
  readonly id?: string;
  /** APQ's hash, which the text, when sent, must match. */
  readonly apq?: string;
}

export function createGraphqlFake(manifest: Readonly<Record<string, string>> = {}): GraphqlFake {
  const reached: string[] = [];
  const failing = new Set<string>();
  const partly = new Set<string>();
  const persisted = new Map<string, string>();

  async function checked(request: Request, params: Params): Promise<Response> {
    const { apq, query } = params;
    if (apq !== undefined && query !== undefined && (await sha256(query)) !== apq) {
      reached.push(`${request.method} #${apq}`);
      return respond(request, MISMATCH, 400);
    }
    return answer(request, params);
  }

  function answer(request: Request, params: Params): Response {
    const text = params.query ?? persisted.get(params.id ?? "") ?? manifest[params.id ?? ""];
    if (text === undefined) {
      reached.push(`${request.method} #${params.id ?? "?"}`);
      return respond(request, NOT_FOUND, 200);
    }
    if (params.id !== undefined) persisted.set(params.id, text);
    const field = /\{\s*(\w+)/.exec(text)?.[1] ?? "";
    reached.push(`${request.method} ${field}`);
    const errors = [
      { message: "boom", path: [field], extensions: { code: "INTERNAL_SERVER_ERROR" } },
    ];
    if (failing.has(field)) return respond(request, { data: null, errors }, 200);
    if (partly.has(field)) return respond(request, { data: { [field]: null }, errors }, 200);
    const data = ROOTS[field];
    if (data === undefined) {
      const message = `Cannot query field "${field}" on type "Query".`;
      const invalid = { errors: [{ message, extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] };
      return respond(request, invalid, 400);
    }
    return respond(request, { data }, 200);
  }

  const handlers: RequestHandler[] = [GRAPHQL, API_GRAPHQL].flatMap((endpoint) => [
    http.get(endpoint, ({ request }) => {
      const search = new URL(request.url).searchParams;
      const apq = hashOf(parse(search.get("extensions")));
      return checked(request, {
        ...optional("query", search.get("query") ?? undefined),
        ...optional("id", search.get("documentId") ?? apq),
        ...optional("apq", apq),
      });
    }),
    http.post(endpoint, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const apq = hashOf(body["extensions"]);
      return checked(request, {
        ...optional("query", body["query"] as string | undefined),
        ...optional("id", (body["documentId"] as string | undefined) ?? apq),
        ...optional("apq", apq),
      });
    }),
  ]);

  return {
    handlers,
    reached,
    fail: (field) => failing.add(field),
    failPartly: (field) => partly.add(field),
    reset() {
      reached.length = 0;
      failing.clear();
      partly.clear();
      persisted.clear();
    },
  };
}

/** The body in the type the client asked for, with a header a codec should keep. */
function respond(request: Request, body: unknown, status: number): Response {
  const accepts = request.headers.get("accept")?.includes(GRAPHQL_RESPONSE) === true;
  const type = accepts ? GRAPHQL_RESPONSE : "application/json";
  return new HttpResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": type, "x-trace": "t1" },
  });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hashOf(extensions: unknown): string | undefined {
  const persisted = (extensions as { persistedQuery?: { sha256Hash?: string } } | undefined)
    ?.persistedQuery;
  return persisted?.sha256Hash;
}

function parse(text: string | null): unknown {
  return text === null ? undefined : JSON.parse(text);
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}
