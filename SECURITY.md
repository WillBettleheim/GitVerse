# Security policy

GitVerse downloads and analyzes repositories chosen by its users, so it treats every repository as
hostile. This page explains how to report a problem and what the project protects against.

## Reporting a vulnerability

Please report privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Don't open a public issue or pull request for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get an
acknowledgement, and a fix or a plan, as soon as possible. There's no bug bounty.

## Supported versions

Only the latest release on the `main` branch receives security fixes.

## What GitVerse protects against

The full model is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model-for-untrusted-repositories).
In brief:

- **No code execution.** Repository content is parsed as text with Tree-sitter. Nothing is
  installed, built, imported or run.
- **No arbitrary requests.** Repository references are allowlisted; requests go only to
  `api.github.com` and `codeload.github.com`, redirects are never followed, and URLs are built from
  validated parts.
- **Archive safety.** Archives are read in memory; links and devices are skipped; any absolute or
  `..` path rejects the archive; download size, entry count, file size, total source, unpacked size
  and time are all limited.
- **Abuse limits.** Per-client rate limits, bounded concurrency and queues, request body limits,
  and disk budgets for caches.
- **Prompt injection.** Repository text sent to the model is quoted as untrusted data, the model has
  no tools, and every file, line and relationship in its answer is checked against the analysis.
- **Secrets.** The Anthropic and GitHub credentials live only on the backend. Nothing secret is in
  the browser bundle, the container images or the repository.
- **Browser hardening.** A Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, strict
  referrer and permissions policies, and CORS limited to configured origins.

## Known gaps

- Analysis runs in the API's own container rather than a separate sandbox.
- Rate limits are per client address and kept in memory; behind a proxy, the proxy must be
  configured as trusted (`FORWARDED_ALLOW_IPS`) for them to see real addresses.
- The Content-Security-Policy allows inline scripts, which Next.js needs for hydration.
