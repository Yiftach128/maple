import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DEVICE_CODE_URL, SETUP_VERIFY_USAGE } from "../src/commands/setup-verify.js";
import { run } from "../src/run.js";
import { createDeviceCodeFake, FLOW_OFF, FLOW_ON, OUTAGE, REJECTED } from "./msw/device-code.js";

const fake = createDeviceCodeFake();
beforeAll(() => fake.server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  fake.reset();
  fake.server.resetHandlers();
});
afterAll(() => fake.server.close());

function verify(clientId: string) {
  return run(["setup", "verify", `--client-id=${clientId}`], { version: "0" });
}

describe("maple setup verify", () => {
  it("says Device Flow is on when GitHub hands out a device code", async () => {
    const result = await verify(FLOW_ON);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Device Flow is on");
  });

  it("never prints the device code or the user code", async () => {
    const { output } = await verify(FLOW_ON);

    expect(output).not.toContain("fake-device-code");
    expect(output).not.toContain("FAKE-CODE");
  });

  it("asks as a form, for JSON, with only the client id and an empty scope", async () => {
    await verify(FLOW_ON);

    expect(fake.asked).toEqual([
      { accept: "application/json", form: { client_id: FLOW_ON, scope: "" } },
    ]);
  });

  it.each([
    ["Device Flow off", FLOW_OFF, "Enable Device Flow"],
    ["a rejected client id", REJECTED, "no App with the client id"],
    ["a client id GitHub does not know", "Iv1.unknown", "no App with the client id"],
    ["an outage", OUTAGE, "GitHub answered 502"],
  ])("exits 1 on %s, saying what to do", async (_, clientId, said) => {
    const result = await verify(clientId);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(said);
  });

  it("exits 1 when GitHub cannot be reached", async () => {
    fake.server.use(http.post(DEVICE_CODE_URL, () => HttpResponse.error()));
    const result = await verify(FLOW_ON);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Could not reach GitHub");
  });

  it("prints its usage and asks nothing without a client id", async () => {
    const result = await run(["setup", "verify"], { version: "0" });

    expect(result).toEqual({ output: SETUP_VERIFY_USAGE, exitCode: 1 });
    expect(fake.asked).toEqual([]);
  });
});
