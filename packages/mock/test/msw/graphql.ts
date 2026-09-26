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

/** What Apollo's persisted-query link would send for `QUERIES.projects`. */
export const PROJECTS_HASH = "5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f60718293a4b5c6d7e8f90";

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

/** A fake GraphQL server, plus what it was asked. */
export interface GraphqlFake {
  readonly handlers: RequestHandler[];
  /** `METHOD field` of every operation that reached it, or `METHOD #id` for a miss. */
  readonly reached: readonly string[];
  /** Answers the operation on `field` with `data: null` and an error until reset. */
  fail(field: string): void;
  /** Forgets every persisted query and every failure. */
  reset(): void;
}

interface Params {
  readonly query?: string;
  readonly id?: string;
}

export function createGraphqlFake(manifest: Readonly<Record<string, string>> = {}): GraphqlFake {
  const reached: string[] = [];
  const failing = new Set<string>();
  const persisted = new Map<string, string>();

  function answer(request: Request, params: Params): Response {
    const text = params.query ?? persisted.get(params.id ?? "") ?? manifest[params.id ?? ""];
    if (text === undefined) {
      reached.push(`${request.method} #${params.id ?? "?"}`);
      return respond(request, NOT_FOUND, 200);
    }
    if (params.id !== undefined) persisted.set(params.id, text);
    const field = /\{\s*(\w+)/.exec(text)?.[1] ?? "";
    reached.push(`${request.method} ${field}`);
    if (failing.has(field)) {
      const errors = [{ message: "boom", extensions: { code: "INTERNAL_SERVER_ERROR" } }];
      return respond(request, { data: null, errors }, 200);
    }
    const data = ROOTS[field];
    if (data === undefined) {
      return respond(request, { errors: [{ message: `Cannot query field "${field}"` }] }, 400);
    }
    return respond(request, { data }, 200);
  }

  const handlers: RequestHandler[] = [
    http.get(GRAPHQL, ({ request }) => {
      const search = new URL(request.url).searchParams;
      const extensions = parse(search.get("extensions"));
      return answer(request, {
        ...optional("query", search.get("query") ?? undefined),
        ...optional("id", search.get("documentId") ?? hashOf(extensions)),
      });
    }),
    http.post(GRAPHQL, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      return answer(request, {
        ...optional("query", body["query"] as string | undefined),
        ...optional("id", (body["documentId"] as string | undefined) ?? hashOf(body["extensions"])),
      });
    }),
  ];

  return {
    handlers,
    reached,
    fail: (field) => failing.add(field),
    reset() {
      reached.length = 0;
      failing.clear();
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
