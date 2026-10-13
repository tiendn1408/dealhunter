/** Hosts only a development build may talk to (see src/lib/build_env.ts). */
const DEV_HOST = /^\*?:?\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/|^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//;

function isDevPattern(pattern: string): boolean {
  return DEV_HOST.test(pattern);
}

/**
 * The manifest for a production build: localhost patterns removed from externally_connectable
 * (web pages allowed to hand over a sign-in session) and from content scripts (the Caffiliate Bench
 * simulator). A content script left with no match is dropped.
 */
export function productionManifest<T extends Record<string, any>>(manifest: T): T {
  const out = structuredClone(manifest) as Record<string, any>;
  if (Array.isArray(out.externally_connectable?.matches)) {
    out.externally_connectable.matches = out.externally_connectable.matches.filter((m: string) => !isDevPattern(m));
  }
  if (Array.isArray(out.content_scripts)) {
    out.content_scripts = out.content_scripts
      .map((cs: Record<string, any>) => ({ ...cs, matches: (cs.matches ?? []).filter((m: string) => !isDevPattern(m)) }))
      .filter((cs: Record<string, any>) => cs.matches.length > 0);
  }
  return out as T;
}
