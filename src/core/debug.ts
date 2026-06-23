/**
 * Tiny debug-logger, zero dependencies. Enable with the standard `DEBUG` env
 * var, namespaced under `urc:`:
 *
 *   DEBUG=urc:*          # everything
 *   DEBUG=urc:watch      # just one namespace
 *   DEBUG=urc:scan,urc:transform
 *
 * No-op (zero allocation, ~5ns per call) when the namespace isn't enabled, so
 * it's safe to leave calls in hot paths.
 */

const NS_PREFIX = "urc:";

/** Compile the `DEBUG` env into a list of matchers. Exported for testing. */
export function parseDebugEnv(env: string | undefined): RegExp[] {
  if (!env) return [];
  return env
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((pat) => {
      // Standard "debug" syntax: '*' is a wildcard, anything else is literal.
      const escaped = pat.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
      const re = "^" + escaped.replace(/\*/g, ".*") + "$";
      return new RegExp(re);
    });
}

// Computed once at module load — env doesn't change at runtime for a build.
const matchers = parseDebugEnv(process.env.DEBUG);

const noop = (): void => {};

/**
 * Build a logger for one namespace. Returns a no-op function when the
 * namespace isn't enabled by `DEBUG`. Output goes to stderr (so it doesn't
 * pollute build-tool stdout that consumers may pipe).
 */
export function createDebug(namespace: string) {
  const full = `${NS_PREFIX}${namespace}`;
  if (!matchers.some((re) => re.test(full))) return noop;
  return (...args: unknown[]) => {
    const parts = args.map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    });
    process.stderr.write(`[${full}] ${parts.join(" ")}\n`);
  };
}
