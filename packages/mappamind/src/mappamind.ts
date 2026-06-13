#!/usr/bin/env node
// The published `mappamind` binary. This wrapper package depends on the scoped
// workspace packages and re-runs the pipeline CLI; importing it executes the
// CLI's main() against this process's argv. Keeping the bin here (rather than
// asking users to install @mappamind_/pipeline directly) is what lets the
// documented install be `npm i -g mappamind-cli` (this package; the `mappamind`
// bare name is cooldown-locked on npm, so the package is published as mappamind-cli).
import "@mappamind_/pipeline/mappamind";
