# Privacy

Mappamind is a local developer tool. It has **no server, no telemetry, and no
analytics**: it never phones home, and the Mappamind project receives nothing about
you, your code, or how you use it.

## What it reads

To build its grounded picture, Mappamind reads the source files and git metadata of
the repository or workspace you run it on. This happens entirely on your machine.

## Where data goes

| Data | Destination |
|---|---|
| Baseline, channel cache, before-snapshot, shift history | Local, under `<root>/.mappamind/state/` (override with `MAPPAMIND_STATE_DIR`) |
| Rendered Studio and shift cards | Local, under `<root>/.mappamind/` — self-contained HTML, no scripts, no external assets, no network calls |
| Mappamind-operated services | None exist. Nothing is sent to us. |

See [Storage and Privacy](README.md#storage-and-privacy) for the exact paths.

## The one external data flow: your model CLI

Mappamind does not call any AI provider directly and handles no API keys. To
synthesize grounded capabilities and narrate shift cards, it shells out to the model
CLI **you** have installed and authenticated — [Claude Code](https://claude.com/claude-code)
(`claude`) or [Codex](https://developers.openai.com/codex) (`codex`).

When it does, **relevant excerpts of your code are sent to that provider** (Anthropic
or OpenAI) as part of the normal operation of the CLI you chose. That transmission is
governed by **your agreement with that provider**, not by Mappamind.

If you do not want any code sent to a model provider, use the deterministic paths that
skip the model call — for example `mappamind shift --no-model`.

## Hooks

The plugin registers `SessionStart` and `Stop` hooks that run the local `mappamind`
command with your shell's permissions. They transmit nothing on their own beyond
invoking the CLI described above.

## Contact

- General questions: open an issue at <https://github.com/mappamind/mappamind/issues>.
- Security or privacy concerns: use GitHub's
  [Report a vulnerability](https://github.com/mappamind/mappamind/security/advisories/new)
  flow (see [SECURITY.md](SECURITY.md)).
