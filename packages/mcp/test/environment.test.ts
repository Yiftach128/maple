import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { branchFromEnvironment, storeFromEnvironment } from "../src/config.js";
import { describeVariable, ENVIRONMENT } from "../src/environment.js";

/** Every quoted upper-case name the file passes to `env[...]` or `required`. */
function namesRead(path: string): string[] {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const names = [...source.matchAll(/(?:env\[|required\(env, )"([A-Z][A-Z0-9_]+)"/g)].map(
    (match) => match[1] ?? "",
  );
  return [...new Set(names)].toSorted((a, b) => a.localeCompare(b));
}

describe("ENVIRONMENT", () => {
  it("lists exactly the variables config.ts reads", () => {
    const listed = ENVIRONMENT.map((variable) => variable.name).toSorted((a, b) =>
      a.localeCompare(b),
    );
    expect(listed).toEqual(namesRead("../src/config.ts"));
  });

  it("describes every variable in a sentence", () => {
    for (const variable of ENVIRONMENT) expect(variable.description).toMatch(/^\S.*\.$/);
  });

  it.each([
    ["GITHUB_TOKEN", /pull-request comments/],
    ["NOT_A_MAPLE_VARIABLE", undefined],
  ])("describeVariable(%s)", (name, expected) => {
    if (expected === undefined) expect(describeVariable(name)).toBeUndefined();
    else expect(describeVariable(name)).toMatch(expected);
  });
});

describe("a missing variable", () => {
  it.each<[string, () => unknown, RegExp]>([
    [
      "the branch",
      () => branchFromEnvironment({}),
      /^MAPLE_BRANCH is not set; .* It is: The branch/,
    ],
    [
      "the owner",
      () => storeFromEnvironment({ GITHUB_TOKEN: "t", MAPLE_GITHUB_REPO: "r" }),
      /^MAPLE_GITHUB_OWNER is not set; .* It is: The repository's owner\./,
    ],
  ])("names %s and says what it is", (_case, start, message) => {
    expect(start).toThrow(message);
  });
});
