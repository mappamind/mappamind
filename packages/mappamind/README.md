# mappamind

Mappamind shows a human what an AI coding agent just did to their system: grounded, visual, in-session at the accept moment.

## Install

```
npm i -g mappamind
```

Requires a model CLI on your `PATH` (`claude` or `codex`) and Node ≥ 20.

## Large repos

Today Mappamind re-reads the whole tree on each session, so the first baseline takes
a few minutes and per-session shifts are slower on very large monorepos (roughly
5,000+ files). It tells you when this applies. Incremental capture — re-parsing only
what changed — is the next step.

## Documentation

Full docs live at the GitHub repo: github.com/mappamind/mappamind
