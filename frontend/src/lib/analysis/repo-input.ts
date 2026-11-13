/**
 * Client-side check of a repository reference, mirroring backend/app/services/repo_ref.py.
 * It gives instant feedback. The backend validates again and is what actually protects anything.
 */

export interface RepoName {
  owner: string;
  name: string;
}

export type RepoInputResult = { ok: true; repo: RepoName } | { ok: false; message: string };

const OWNER = /^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/;
const NAME = /^[A-Za-z0-9._-]+$/;
const HOSTS = new Set(["github.com", "www.github.com"]);

export function parseRepoInput(raw: string): RepoInputResult {
  const value = raw.trim();
  if (!value) return fail("Enter a GitHub repository, like owner/name.");
  if (value.length > 300) return fail("That's too long to be a repository address.");
  if (/[\s\\\u0000-\u001f]/.test(value)) return fail("Repository addresses can't contain spaces.");

  let path = value;
  if (value.includes("://")) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return fail("That isn't a valid address.");
    }
    if (url.protocol !== "https:") return fail("Use an https://github.com address.");
    if (url.username || url.password || url.port) {
      return fail("Remove any username, password or port from the address.");
    }
    if (!HOSTS.has(url.hostname)) return fail("Only github.com repositories are supported.");
    if (url.search || url.hash) return fail("Remove the ? or # part of the address.");
    path = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }

  const segments = path.split("/");
  if (segments.length !== 2) {
    return fail("Use the repository's main address: owner/name, without extra path parts.");
  }
  const owner = segments[0];
  const name = segments[1].replace(/\.git$/, "");
  if (owner.length > 39 || !OWNER.test(owner)) return fail("That isn't a valid GitHub owner.");
  if (name.length > 100 || !NAME.test(name) || name.startsWith(".") || name.startsWith("-")) {
    return fail("That isn't a valid repository name.");
  }
  return { ok: true, repo: { owner, name } };
}

function fail(message: string): RepoInputResult {
  return { ok: false, message };
}
