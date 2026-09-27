import { describe, expect, it } from "vitest";

import {
  appRegistrationUrl,
  GITHUB_APP_PERMISSIONS,
  SETUP_APP_USAGE,
} from "../src/commands/setup-app.js";
import { run } from "../src/run.js";

function app(...flags: string[]) {
  return run(["setup", "app", ...flags], { version: "0" });
}

function queryOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("GITHUB_APP_PERMISSIONS", () => {
  it("gives the comment App pull requests and nothing else", () => {
    expect(GITHUB_APP_PERMISSIONS.comment).toEqual({ pull_requests: "write" });
  });

  it("gives the gate App checks and nothing else", () => {
    expect(GITHUB_APP_PERMISSIONS.gate).toEqual({ checks: "write" });
  });
});

describe("appRegistrationUrl", () => {
  it.each([
    [false, "https://github.com/organizations/acme/settings/apps/new"],
    [true, "https://github.com/settings/apps/new"],
  ])("registers under the right account when personal is %s", (personal, base) => {
    const url = appRegistrationUrl({ kind: "comment", owner: "acme", personal });

    expect(url.split("?")[0]).toBe(base);
  });

  it("fills in every field a URL can carry, for the comment App", () => {
    const query = queryOf(appRegistrationUrl({ kind: "comment", owner: "acme", personal: false }));

    expect(Object.fromEntries(query)).toEqual({
      name: "Maple — acme",
      description: expect.any(String) as string,
      url: "https://github.com/maple-kit/maple",
      public: "false",
      webhook_active: "false",
      request_oauth_on_install: "false",
      "callback_urls[]": "https://github.com/acme",
      pull_requests: "write",
    });
  });

  it.each(["issues", "contents", "checks"])("never asks the comment App for %s", (permission) => {
    const query = queryOf(appRegistrationUrl({ kind: "comment", owner: "acme", personal: false }));

    expect(query.has(permission)).toBe(false);
  });

  it("asks the gate App for checks alone", () => {
    const query = queryOf(appRegistrationUrl({ kind: "gate", owner: "acme", personal: false }));

    expect(query.get("checks")).toBe("write");
    expect(query.has("pull_requests")).toBe(false);
    expect(query.get("name")).toBe("Maple gate — acme");
  });

  it("takes a name in place of the default", () => {
    const url = appRegistrationUrl({ kind: "comment", owner: "acme", personal: false, name: "X" });

    expect(queryOf(url).get("name")).toBe("X");
  });
});

describe("maple setup app", () => {
  it("prints the URL and then the steps no URL parameter can set", async () => {
    const result = await app("--owner=acme");

    expect(result.exitCode).toBe(0);
    for (const said of [
      "https://github.com/organizations/acme/settings/apps/new?",
      "Enable Device Flow on",
      "Expire user authorization tokens off",
      "Do not generate a private key",
      "app-logo.png",
      "#fdf8e8",
      "Only select repositories",
      "MAPLE_GITHUB_CLIENT_ID",
      "starts with Iv",
    ]) {
      expect(result.output).toContain(said);
    }
  });

  it("prints the gate App's own steps for --gate", async () => {
    const { output } = await app("--owner=acme", "--gate");

    for (const said of [
      "checks=write",
      "Generate a private key",
      "Leave Enable Device Flow off",
      "MAPLE_GATE_APP_ID",
      "MAPLE_GATE_INSTALLATION_ID",
      "MAPLE_GATE_PRIVATE_KEY",
    ]) {
      expect(output).toContain(said);
    }
    expect(output).not.toContain("pull_requests=write");
  });

  it("emits the URL, the permissions and the steps for --json", async () => {
    const result = await app("--owner=acme", "--personal", "--json");
    const parsed = JSON.parse(result.output) as { url: string; permissions: unknown };

    expect(parsed.url.startsWith("https://github.com/settings/apps/new?")).toBe(true);
    expect(parsed.permissions).toEqual({ pull_requests: "write" });
  });

  it.each([[[]], [["--owner"]], [["--owner=acme/web"]]])(
    "prints its usage for %j",
    async (flags) => {
      expect(await app(...flags)).toEqual({ output: SETUP_APP_USAGE, exitCode: 1 });
    },
  );
});
