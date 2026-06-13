# Mappamind

Show a human what an AI coding agent just did to their system — grounded, visual,
in-session at the accept moment. Read docs/ARCHITECTURE.md first.

- Build: `npm run build` · Test: `npm test` (node:test, all packages)
- The leash rule: every intelligent output must cite a real code fact or be dropped.
- The anti-treadmill rule: new language/medium coverage = a prompt + schema, never new code.
- Rendered surfaces are self-contained HTML: no `<script>`, no external assets.
