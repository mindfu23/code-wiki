/**
 * Log redaction for CI. The Actions logs of a public repo are public, and the
 * repos this tool indexes can be private, so in CI nothing that names a repo
 * or a file inside one may be printed. Every build script logs through these
 * helpers instead of interpolating names directly.
 */

export const CI_LOG = !!process.env.CI;

/** A repo name, owner/repo pair or file path: printed locally, hidden in CI. */
export const nm = (name: string): string => (CI_LOG ? '<repo>' : name);

/**
 * An error from Octokit or fetch. Octokit messages can quote the request URL,
 * which carries the repo name, so CI gets only the HTTP status.
 */
export function errMsg(err: unknown): string {
  const e = err as { status?: number; message?: string };
  if (CI_LOG) return e.status ? `HTTP ${e.status}` : 'error';
  return e.message ?? String(err);
}
