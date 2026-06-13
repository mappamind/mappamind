import assert from "node:assert/strict";

import { FEEDBACK_URL } from "./theme.js";

// Offline invariant (decision 4A): rendered HTML surfaces must be self-contained with
// no auto-loading vectors, and the ONLY external http href is the feedback link. A flat
// "no https in href" check cannot tell an allowed <a> from a banned <link>/<img>, so we
// assert by element kind and pin the single external href to FEEDBACK_URL.
export function assertOfflineSafe(html: string): void {
  assert.ok(!html.includes("<script"), "no scripts");
  assert.ok(!/\b(?:src|srcset)\s*=\s*["']https?:/i.test(html), "no external src/srcset");
  assert.ok(!/<(?:iframe|img|link)\b/i.test(html), "no auto-loading elements");
  assert.ok(!/url\(\s*["']?https?:/i.test(html), "no external url() in CSS");
  const externalHrefs = [...html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]);
  assert.ok(externalHrefs.length >= 1, "feedback link present");
  assert.ok(externalHrefs.every((h) => h === FEEDBACK_URL), "feedback link is the only external href");
}
