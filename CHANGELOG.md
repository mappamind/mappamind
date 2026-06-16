# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-06-17

### Fixed

- A cross-service channel that lost its provider — a route consumers still call but nothing serves — was misreported as a benign "changed" instead of broken, and did not earn the red severity tag. Channel identity now keys on the normalized channel key, so a lost provider reads as a break and a provider swap is a single "changed" rather than contradictory added/removed rows.

### Changed

- Redesigned the rendered surfaces (Studio, shift card, examples gallery) into a self-contained cartographic theme: an embedded display face and the inlined brand logo, a parchment/ink palette, and a CSS-only theme toggle that now defaults to the dark night chart. Output stays offline-safe — no scripts, no external assets.

## [0.1.0] - 2026-06-14

Initial public release.

### Added

- Baseline Studio: a self-contained HTML view of a repo or workspace architecture, written to `.mappamind/index.html`.
- Cross-service channels: a grounded service mesh and Contracts, detected from real code by model adjudication behind a deterministic verifier — no per-framework catchers.
- Shift card: a before/after view of what an agent changed, rendered at the accept moment.
- The leash: every intelligent output cites a real code fact or is dropped, keeping comprehension grounded.
- Multi-repo workspace support: analyse several repos together with qualified `repo/path` paths and cross-repo channels.
- Dual-host lifecycle hooks for Claude Code and Codex.
- The `mappamind` CLI with `status`, `setup`, `hooks`, `snapshot`, `shift`, `baseline`, and `watch` commands.

[Unreleased]: https://github.com/mappamind/mappamind/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/mappamind/mappamind/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mappamind/mappamind/releases/tag/v0.1.0
