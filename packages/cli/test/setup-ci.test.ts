import { describe, expect, it } from "vitest";

import {
  CHECK_NAME,
  gateWorkflow,
  rulesetCommand,
  WORKFLOW_PATH,
} from "../src/commands/setup-ci.js";
import { run } from "../src/run.js";

import type { WorkflowFs } from "../src/commands/setup-ci.js";

const CWD = "/work/repo";
const TARGET = `${CWD}/${WORKFLOW_PATH}`;

function memoryFs(existing: readonly string[] = []) {
  const files = new Map<string, string>(existing.map((path) => [path, "old"]));
  const fs: WorkflowFs = {
    exists: (path) => files.has(path),
    write: (path, content) => files.set(path, content),
  };
  return { fs, files };
}

function ci(flags: string[], fs?: WorkflowFs) {
  return run(["setup", "ci", ...flags], { version: "0", cwd: CWD, ...(fs ? { fs } : {}) });
}

describe("gateWorkflow", () => {
  it("runs on pull requests and merge queues, with the permissions sync and gate need", () => {
    const workflow = gateWorkflow(false);

    expect(workflow).toContain("on:\n  pull_request:\n  merge_group:\n");
    expect(workflow).toContain(
      "permissions:\n      contents: read\n      checks: write\n      pull-requests: write\n",
    );
  });

  it("runs sync before gate", () => {
    const workflow = gateWorkflow(false);

    expect(workflow.indexOf("mode: sync")).toBeLessThan(workflow.indexOf("mode: gate"));
    expect(workflow.match(/maple-kit\/maple-action@v0/g)).toHaveLength(2);
  });

  it.each([
    [false, false],
    [true, true],
  ])("asks for an approval only when told to (%s)", (requireApproval, present) => {
    expect(gateWorkflow(requireApproval).includes('require-approval: "true"')).toBe(present);
  });
});

describe("rulesetCommand", () => {
  function rulesetOf(command: string): unknown {
    return JSON.parse(command.split("<<'JSON'\n")[1]!.replace(/\nJSON$/, ""));
  }

  it("requires the check pinned to GitHub Actions by default", () => {
    expect(rulesetOf(rulesetCommand())).toMatchObject({
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
      rules: [
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: CHECK_NAME, integration_id: 15368 }] },
        },
      ],
    });
  });

  it("pins another App when given one", () => {
    expect(rulesetCommand(42)).toContain('"integration_id": 42');
  });
});

describe("maple setup ci", () => {
  it("prints the workflow and the ruleset command without touching the disk", async () => {
    const { fs, files } = memoryFs();
    const result = await ci([], fs);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(gateWorkflow(false));
    expect(result.output).toContain("gh api --method POST 'repos/{owner}/{repo}/rulesets'");
    expect(result.output).toContain("gate App's own App ID");
    expect(files.size).toBe(0);
  });

  it("writes the workflow with --write", async () => {
    const { fs, files } = memoryFs();
    const result = await ci(["--write", "--require-approval"], fs);

    expect(result.exitCode).toBe(0);
    expect(files.get(TARGET)).toBe(gateWorkflow(true));
    expect(result.output).toContain("rulesets");
  });

  it("refuses to overwrite a workflow that is already there", async () => {
    const { fs, files } = memoryFs([TARGET]);
    const result = await ci(["--write"], fs);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("already exists");
    expect(files.get(TARGET)).toBe("old");
  });

  it("exits 1 when the write fails", async () => {
    const fs: WorkflowFs = {
      exists: () => false,
      write: () => {
        throw new Error("read-only");
      },
    };
    const result = await ci(["--write"], fs);

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.output).toContain("read-only");
  });
});

describe("maple setup", () => {
  it("prints every subcommand's usage for an unknown one", async () => {
    const result = await run(["setup", "nope"], { version: "0" });

    expect(result.exitCode).toBe(1);
    for (const sub of ["setup app", "setup verify", "setup ci"])
      expect(result.output).toContain(sub);
  });
});
