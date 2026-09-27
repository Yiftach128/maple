/**
 * `maple setup app`: the prefilled GitHub App registration URL, and the steps
 * GitHub's URL parameters cannot set. The permission sets live here once, so
 * every document that describes the Apps can point at this command instead of
 * copying them by hand.
 */

import { isSet } from "../args.js";

import type { ParsedArgs } from "../args.js";

/**
 * The repository permissions each of Maple's two GitHub Apps is registered
 * with, and nothing more. GitHub adds `metadata: read` to every App by itself.
 */
export const GITHUB_APP_PERMISSIONS = {
  // Every comment call goes to /issues/…, but GitHub authorises an issue-comment
  // endpoint on a pull request under Pull requests. Granting Issues would hand
  // each reviewer's token every issue in the repository, and Contents or Checks
  // would reach code and the gate; see docs/github-auth.md.
  comment: { pull_requests: "write" },
  gate: { checks: "write" },
} as const satisfies Record<string, Readonly<Record<string, "read" | "write">>>;

/** Which of the two Apps is being registered. */
export type AppKind = keyof typeof GITHUB_APP_PERMISSIONS;

/** What registering an App needs to know about where it goes. */
export interface AppRegistration {
  readonly kind: AppKind;
  readonly owner: string;
  readonly personal: boolean;
  readonly name?: string;
}

/** What the command prints, and its exit code. */
export interface SetupAppResult {
  readonly output: string;
  readonly exitCode: number;
}

export const SETUP_APP_USAGE = `Usage
  maple setup app --owner=<org-or-user> [--personal] [--gate] [--name=<name>] [--json]

  --owner     The organisation (or, with --personal, the account) the App belongs to.
  --personal  Register it under a personal account rather than an organisation.
  --gate      The gate App (Checks) instead of the comment App (Pull requests).
  --name      The App's name. It must be unique on all of GitHub.`;

const HOMEPAGE = "https://github.com/maple-kit/maple";
const LOGO = "https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/app-logo.png";
const BADGE = "#fdf8e8";

const DESCRIPTIONS: Record<AppKind, string> = {
  comment: "Maple visual review comments, posted to a pull request as the reviewer.",
  gate: "Publishes Maple's maple/visual-review check run.",
};

function defaultName(kind: AppKind, owner: string): string {
  return kind === "comment" ? `Maple — ${owner}` : `Maple gate — ${owner}`;
}

/** The GitHub App registration URL, with every field a URL can carry filled in. */
export function appRegistrationUrl(registration: AppRegistration): string {
  const { kind, owner, personal } = registration;
  const base = personal
    ? "https://github.com/settings/apps/new"
    : `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new`;
  const query = new URLSearchParams({
    name: registration.name ?? defaultName(kind, owner),
    description: DESCRIPTIONS[kind],
    url: HOMEPAGE,
    public: "false",
    webhook_active: "false",
    request_oauth_on_install: "false",
  });
  query.append("callback_urls[]", `https://github.com/${owner}`);
  for (const [permission, access] of Object.entries(GITHUB_APP_PERMISSIONS[kind])) {
    query.append(permission, access);
  }
  return `${base}?${query.toString()}`;
}

const LOGO_STEP = `Under Display information, upload the Maple logo (${LOGO}) and set Badge background colour to ${BADGE}.`;

/** What the registration URL cannot set, in the order a person meets it. */
export function manualSteps(kind: AppKind): readonly string[] {
  if (kind === "gate") {
    return [
      "Leave Enable Device Flow off. This App acts as itself and never signs a reviewer in.",
      "Create the App, then Generate a private key. Its contents are MAPLE_GATE_PRIVATE_KEY, a secret.",
      LOGO_STEP,
      "Install App → Only select repositories → the same repositories the comment App is on.",
      "The App ID on the settings page is MAPLE_GATE_APP_ID; the number at the end of the installation's settings URL is MAPLE_GATE_INSTALLATION_ID.",
      "None of this is needed to gate in CI: `maple setup ci` publishes the check on the workflow's own token.",
    ];
  }
  return [
    "Under Identifying and authorizing users, turn Enable Device Flow on.",
    "Turn Expire user authorization tokens off.",
    "Create the App. Do not generate a private key: nothing in the comment path uses one.",
    LOGO_STEP,
    "Install App → Only select repositories → the ones that should be reviewable.",
    "Copy the Client ID (it starts with Iv; it is not the App ID) into MAPLE_GITHUB_CLIENT_ID.",
    "Check it with `maple setup verify --client-id=<Iv…>`.",
  ];
}

function readRegistration(flags: ParsedArgs["flags"]): AppRegistration | undefined {
  const owner = stringFlag(flags, "owner");
  if (owner === undefined || !/^[A-Za-z0-9-]+$/.test(owner)) return undefined;
  const name = stringFlag(flags, "name");
  return {
    kind: isSet(flags, "gate") ? "gate" : "comment",
    owner,
    personal: isSet(flags, "personal"),
    ...(name === undefined ? {} : { name }),
  };
}

/** Runs the command. Nothing here exits the process. */
export function setupApp(flags: ParsedArgs["flags"], json: boolean): SetupAppResult {
  const registration = readRegistration(flags);
  if (registration === undefined) return { output: SETUP_APP_USAGE, exitCode: 1 };

  const url = appRegistrationUrl(registration);
  const permissions = GITHUB_APP_PERMISSIONS[registration.kind];
  const steps = manualSteps(registration.kind);
  if (json) {
    return { output: JSON.stringify({ url, permissions, steps }, null, 2), exitCode: 0 };
  }

  const granted = Object.entries(permissions)
    .map(([permission, access]) => `${permission}: ${access}`)
    .join(", ");
  const numbered = steps.map((step, index) => `  ${String(index + 1)}. ${step}`);
  const lines = [
    `Register the ${registration.kind} App here:`,
    "",
    url,
    "",
    `Permissions: ${granted} (GitHub adds metadata: read).`,
    "",
    "Then, by hand, since no URL parameter sets these:",
    ...numbered,
  ];
  return { output: lines.join("\n"), exitCode: 0 };
}

function stringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
