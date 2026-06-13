# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[**Report a vulnerability**](https://github.com/mappamind/mappamind/security/advisories/new)
flow — not in public issues or Discussions. We aim to acknowledge a report within a
few days and will coordinate a fix and disclosure timeline with you.

## Scope worth knowing

Mappamind is a local CLI. It reads your repository, writes artifacts under
`.mappamind/`, and shells out to a model CLI (`claude` or `codex`) already on your
`PATH` — there is no Mappamind server and no telemetry. Two areas are most relevant
to security review:

- **Rendered output** (cards and the Studio) is self-contained HTML with no
  `<script>`, no external assets, and no network calls — by design and enforced in
  tests. A regression that introduces any of these is a security bug.
- **Untrusted input.** Session transcripts and repository contents are treated as
  untrusted: the verifier re-grounds every model claim against real code facts before
  it is shown. A path that lets unverified or injected content reach a rendered claim
  is in scope.

## Supported versions

Security fixes target the latest published `mappamind` release.
