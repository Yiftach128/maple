/**
 * A fake of GitHub's `POST /login/device/code`, keyed by client id, recording
 * each form it was sent. The answers are the shapes GitHub gives for an App
 * with Device Flow on, one with it off, a client id it does not know, and an
 * outage.
 */

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { DEVICE_CODE_URL } from "../../src/commands/setup-verify.js";

export const FLOW_ON = "Iv1.deviceflowon";
export const FLOW_OFF = "Iv1.deviceflowoff";
export const REJECTED = "Iv1.rejected";
export const OUTAGE = "Iv1.outage";

export function createDeviceCodeFake() {
  const asked: { accept: string | null; form: Record<string, string> }[] = [];

  const server = setupServer(
    http.post(DEVICE_CODE_URL, async ({ request }) => {
      const form = Object.fromEntries(new URLSearchParams(await request.text()));
      asked.push({ accept: request.headers.get("accept"), form });
      switch (form["client_id"]) {
        case FLOW_ON:
          return HttpResponse.json({
            device_code: "fake-device-code",
            user_code: "FAKE-CODE",
            verification_uri: "https://github.com/login/device",
            expires_in: 899,
            interval: 5,
          });
        case FLOW_OFF:
          return HttpResponse.json({ error: "device_flow_disabled" }, { status: 400 });
        case REJECTED:
          return HttpResponse.json({ error: "incorrect_client_credentials" }, { status: 400 });
        case OUTAGE:
          return new HttpResponse("upstream unavailable", { status: 502 });
        default:
          return HttpResponse.json({ error: "Not Found" }, { status: 404 });
      }
    }),
  );

  return {
    server,
    asked,
    reset() {
      asked.length = 0;
    },
  };
}
