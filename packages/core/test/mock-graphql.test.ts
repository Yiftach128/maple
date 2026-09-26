import { readGraphqlOperation } from "@maple-kit/core/mock";
import { describe, expect, it } from "vitest";

const ME = "{ me { id name } }";
const PROJECTS = "query Projects($first: Int) { projects(first: $first) { id } }";
const CREATE = "mutation CreateProject($name: String!) { createProject(name: $name) { id } }";
const HASH = /^graphql:[\da-f]{8}$/;

describe("readGraphqlOperation", () => {
  it.each([
    ["the request's operationName", { operationName: "Projects", query: PROJECTS }, "Projects"],
    ["operationName over the text", { operationName: "Other", query: PROJECTS }, "Other"],
    ["operationName alone", { operationName: "Projects" }, "Projects"],
    ["the one named query", { query: PROJECTS }, "Projects"],
    ["the one named mutation", { query: CREATE }, "CreateProject"],
    [
      "a name after a fragment",
      { query: `fragment F on User { id } query Me { me { ...F } }` },
      "Me",
    ],
    ["a name before directives", { query: "subscription Ticks @live { tick }" }, "Ticks"],
    ["a persisted id", { documentId: "e3b0c442" }, "e3b0c442"],
    [
      "a persisted id over nothing else",
      { operationName: "", query: null, documentId: "e3" },
      "e3",
    ],
  ])("keys by %s", (_, params, name) => {
    expect(readGraphqlOperation(params)?.key).toBe(`graphql:${name}`);
  });

  it.each([
    ["the shorthand", ME],
    ["an anonymous query", "query { me { id } }"],
    ["an anonymous query with variables", "query ($id: ID!) { user(id: $id) { id } }"],
    ["two named operations and no operationName", `${PROJECTS} ${CREATE}`],
    ["a document with no operation", "fragment F on User { id }"],
    ["text that is not GraphQL", "SELECT 1"],
  ])("keys %s by a hash of the text", (_, query) => {
    expect(readGraphqlOperation({ query })?.key).toMatch(HASH);
  });

  it("hashes the tokens, so comments, commas and whitespace do not change the key", () => {
    const printed = readGraphqlOperation({ query: ME })?.key;
    for (const query of ["{me{id name}}", "{ me { id, name, } }", "{ me { # who\n id\n name } }"]) {
      expect(readGraphqlOperation({ query })?.key).toBe(printed);
    }
    expect(readGraphqlOperation({ query: "{ me { id } }" })?.key).not.toBe(printed);
    const spread = readGraphqlOperation({ query: "{ me { ...F } }" })?.key;
    expect(readGraphqlOperation({ query: "{ me { ... F } }" })?.key).toBe(spread);
  });

  it("pins the hash, since a recipe carries it", () => {
    expect(readGraphqlOperation({ query: ME })?.key).toBe("graphql:4b04480d");
    expect(readGraphqlOperation({ query: "query { me { id name } }" })?.key).toBe(
      "graphql:3ea6e5b1",
    );
  });

  it.each([
    ["a field named query", `{ search(query: "mutation Evil") { query { id } } }`],
    ["a keyword in a string", `{ text(value: "query Evil {") { id } }`],
    ["a keyword in a block string", `{ text(value: """\nquery Evil\n""") { id } }`],
    ["a keyword in a comment", "# query Evil\n{ me { id } }"],
    ["an input object in a default value", "query ($f: F = { query: 1 }) { me { id } }"],
  ])("does not read %s as a name", (_, query) => {
    expect(readGraphqlOperation({ query })?.key).toMatch(HASH);
  });

  it.each([
    ["a query", { query: PROJECTS }, "query"],
    ["the shorthand", { query: ME }, "query"],
    ["a mutation", { query: CREATE }, "mutation"],
    [
      "the operation the name picks",
      { operationName: "CreateProject", query: `${PROJECTS} ${CREATE}` },
      "mutation",
    ],
    ["a name the text does not define", { operationName: "Other", query: PROJECTS }, undefined],
    ["several operations and no name", { query: `${PROJECTS} ${CREATE}` }, undefined],
    ["a persisted id", { documentId: "e3b0c442" }, undefined],
  ])("types %s", (_, params, type) => {
    expect(readGraphqlOperation(params)?.type).toBe(type);
  });

  it.each([
    ["nothing", {}],
    ["blanks", { operationName: "", query: "  ", documentId: "" }],
    ["nulls", { operationName: null, query: null, documentId: null }],
    ["a comment alone", { query: "# nothing here" }],
    ["an operationName that is not a name", { operationName: "not a name" }],
  ])("names nothing from %s", (_, params) => {
    expect(readGraphqlOperation(params)).toBeUndefined();
  });
});
