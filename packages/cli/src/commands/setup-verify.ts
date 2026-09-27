/**
 * `maple setup verify --client-id=<Iv…>`: asks GitHub for a device code the
 * way a reviewer's first sign-in will, so a comment App with Device Flow off is
 * found by the person who registered it rather than by the first reviewer.
 */

import type { FlagSpec, ParsedArgs } from "../args.js";

/** What the command prints, and its exit code. */
export interface SetupVerifyResult {
  readonly output: string;
  readonly exitCode: number;
}

export const SETUP_VERIFY_FLAGS = { "client-id": "string" } as const satisfies FlagSpec;

export const SETUP_VERIFY_USAGE = `Usage
  maple setup verify --client-id=<Iv…>

  --client-id  The comment App's Client ID, starting Iv. Not the App ID.`;

export const DEVICE_CODE_URL = "https://github.com/login/device/code";

interface DeviceCodeAnswer {
  readonly device_code?: string;
  readonly error?: string;
}

/** Runs the command. The device and user codes it receives are never printed. */
export async function setupVerify(
  flags: ParsedArgs["flags"],
  fetcher: typeof fetch = globalThis.fetch,
): Promise<SetupVerifyResult> {
  const value = flags["client-id"];
  const clientId = typeof value === "string" ? value.trim() : "";
  if (clientId === "") return failed(SETUP_VERIFY_USAGE);

  let response: Response;
  try {
    response = await fetcher(DEVICE_CODE_URL, {
      method: "POST",
      headers: { accept: "application/json" },
      body: new URLSearchParams({ client_id: clientId, scope: "" }),
    });
  } catch (error) {
    return failed(`Could not reach GitHub: ${String(error)}`);
  }
  return verdict(response.status, await answerOf(response), clientId);
}

function verdict(status: number, answer: DeviceCodeAnswer, clientId: string): SetupVerifyResult {
  if (answer.device_code) {
    return { output: `Device Flow is on for ${clientId}. Reviewers can sign in.`, exitCode: 0 };
  }
  if (answer.error === "device_flow_disabled") {
    return failed(
      `Device Flow is off for ${clientId}, so every reviewer's sign-in will fail.\n` +
        "Fix: the App's settings → Identifying and authorizing users → Enable Device Flow. " +
        "No reinstall is needed.",
    );
  }
  if (status === 404 || answer.error === "incorrect_client_credentials") {
    return failed(
      `GitHub has no App with the client id ${clientId}. ` +
        "Copy the Client ID (it starts with Iv), not the App ID.",
    );
  }
  const said = answer.error ? `: ${answer.error}` : "";
  return failed(`GitHub answered ${String(status)}${said}.`);
}

/** The JSON body, or nothing when GitHub answered with something else. */
async function answerOf(response: Response): Promise<DeviceCodeAnswer> {
  try {
    return (await response.json()) as DeviceCodeAnswer;
  } catch {
    return {};
  }
}

function failed(output: string): SetupVerifyResult {
  return { output, exitCode: 1 };
}
