/**
 * Naming a GraphQL operation the way a recipe will: `graphql:GetProjects`.
 *
 * It lives here rather than in `@maple-kit/mock` because the route will name
 * the same operations when it serves their shapes, and one key computed in
 * two places is two keys. There is no `graphql` dependency: what is needed
 * is each top-level definition's header and a stable hash of the text, and
 * a lexer that knows strings and comments gives both without a parse.
 */

import { fnv1a32 } from "../lib/fnv1a.js";

/** The request parameters of GraphQL over HTTP that name an operation. */
export interface GraphqlParams {
  /** The `operationName` the request carries, when it names one. */
  readonly operationName?: string | null;
  /** The document text, when it travels with the request. */
  readonly query?: string | null;
  /** A persisted document's id: APQ's `sha256Hash`, or a manifest's `documentId`. */
  readonly documentId?: string | null;
}

export type GraphqlOperationType = "query" | "mutation" | "subscription";

/** An operation as a recipe names it, and its type when the text says. */
export interface GraphqlOperation {
  /**
   * `graphql:` and the operation's name; a hash of its text when it has
   * none, or its persisted id when no text travels with the request.
   */
  readonly key: string;
  /** Known from the document text alone: a persisted id says nothing. */
  readonly type?: GraphqlOperationType;
}

interface Definition {
  readonly type: GraphqlOperationType;
  readonly name?: string;
}

const NAME = /^[_A-Za-z]\w*$/;
const TYPES: ReadonlySet<string> = new Set(["query", "mutation", "subscription"]);
// Block strings, strings, comments, punctuators (a dot each), then any other run.
const TOKEN =
  /"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"|#[^\n\r]*|[!$&().:=@[\]{|}]|[^\s,!$&().:=@[\]{|}"#]+/g;
const BRACE: Readonly<Record<string, number>> = { "{": 1, "}": -1 };
const PAREN: Readonly<Record<string, number>> = { "(": 1, ")": -1 };

/**
 * The operation `params` name, or undefined when nothing does. A named
 * operation is keyed by its name, `operationName` first. An anonymous one is
 * keyed by a hash of its text with comments, commas and whitespace dropped,
 * so the same operation printed two ways is one call. A document with
 * several operations and no `operationName` is one the server refuses, and
 * is keyed by its hash like an anonymous one.
 */
export function readGraphqlOperation(params: GraphqlParams): GraphqlOperation | undefined {
  const name = params.operationName ?? "";
  const lexed = tokens(params.query ?? "");
  const found = definitions(lexed);
  const named = NAME.test(name);
  const chosen = named ? found.find((definition) => definition.name === name) : only(found);
  if (named) return { key: `graphql:${name}`, ...typed(chosen) };
  if (lexed.length > 0) return { key: `graphql:${chosen?.name ?? hash(lexed)}`, ...typed(chosen) };
  const id = params.documentId ?? "";
  return id === "" ? undefined : { key: `graphql:${id}` };
}

/** The document's lexical tokens, with comments, commas and whitespace dropped. */
function tokens(text: string): readonly string[] {
  return (text.match(TOKEN) ?? []).filter((token) => !token.startsWith("#"));
}

function hash(lexed: readonly string[]): string {
  return fnv1a32(lexed.join(" ")).toString(16).padStart(8, "0");
}

/**
 * Each top-level definition, read from the tokens before its selection set:
 * `query Foo ( $id : ID ! )`, or none for the shorthand `{ ... }`.
 */
function definitions(lexed: readonly string[]): readonly Definition[] {
  const found: Definition[] = [];
  let header: string[] = [];
  let braces = 0;
  let parens = 0;
  for (const token of lexed) {
    if (braces > 0) {
      braces += BRACE[token] ?? 0;
      if (braces === 0) {
        const definition = definitionOf(header);
        if (definition !== undefined) found.push(definition);
        header = [];
      }
    } else if (token === "{" && parens === 0) {
      braces = 1;
    } else {
      parens += PAREN[token] ?? 0;
      header.push(token);
    }
  }
  return found;
}

function definitionOf(header: readonly string[]): Definition | undefined {
  const [first, second] = header;
  if (first === undefined) return { type: "query" };
  if (!TYPES.has(first)) return undefined;
  const type = first as GraphqlOperationType;
  return second !== undefined && NAME.test(second) ? { type, name: second } : { type };
}

function only<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

function typed(definition: Definition | undefined): Pick<GraphqlOperation, "type"> {
  return definition === undefined ? {} : { type: definition.type };
}
