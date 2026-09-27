/**
 * Reads each package's `latest` dist-tag from an npm registry with plain
 * `fetch`, so the sweep runs on Node's builtins. One request per name, one at
 * a time: a sweep reads a couple of dozen names once a week.
 */

/** Where to read, and how. */
export interface RegistryOptions {
  /** Replaced in tests. Defaults to the global. */
  readonly fetch?: typeof fetch;
  /** Defaults to the public registry. */
  readonly registry?: string | undefined;
}

/** The latest version of each name that answered, and why each other did not. */
export interface Latest {
  readonly errors: readonly string[];
  readonly versions: ReadonlyMap<string, string>;
}

export const PUBLIC_REGISTRY = "https://registry.npmjs.org";
const TIMEOUT_MS = 15_000;

/** The `latest` dist-tag of every name in `names`. A failure is recorded, not thrown. */
export async function latestVersions(
  names: Iterable<string>,
  options: RegistryOptions = {},
): Promise<Latest> {
  const send = options.fetch ?? fetch;
  const root = (options.registry ?? PUBLIC_REGISTRY).replace(/\/$/, "");
  const versions = new Map<string, string>();
  const errors: string[] = [];
  for (const name of [...new Set(names)].toSorted((a, b) => a.localeCompare(b))) {
    try {
      const response = await send(`${root}/-/package/${name}/dist-tags`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`the registry answered ${String(response.status)}`);
      const tags = (await response.json()) as { latest?: unknown };
      if (typeof tags.latest !== "string") throw new Error("it has no latest dist-tag");
      versions.set(name, tags.latest);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
  return { errors, versions };
}
