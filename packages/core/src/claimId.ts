// Stable, position-independent identity for channel claims.
//
// Two runs over identical code must produce identical IDs so the diff is a true
// set-delta, not model mood (plan invariant I5). `channelClaimId` keys a claim by
// its normalized identity (key + endpoints), never by file position; `anchorHash`
// keys the cited evidence so a cached claim can be reused verbatim iff its anchors
// are unchanged. Both are content hashes — see docs/v2-PLAN.md §5.

import { createHash } from "node:crypto";

// NUL is illegal in the inputs we hash (paths, source spans), so it is a safe
// field separator that no real value can forge a collision across.
const SEP = "";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Identity of a channel between two endpoints. Order the pair lexically so the
// same channel hashes identically regardless of which side we saw first; the
// normalized key (route/topic/contract) disambiguates two channels on one pair.
export function channelClaimId(normalizedKey: string, a: string, b: string): string {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return sha256(`${normalizedKey}${SEP}${lo}${SEP}${hi}`);
}

// Identity of a single membership/endpoint claim — one service's participation in
// a channel, grounded at one cited span. The verifier re-finds exactly this text.
export function membershipAnchorHash(service: string, file: string, text: string): string {
  return sha256(`${service}${SEP}${file}${SEP}${text}`);
}

// Identity of the EVIDENCE behind a two-sided claim: reuse a cached adjudication
// verbatim iff this hash is unchanged (plan §5). Endpoint order normalized so the
// hash is independent of which end was listed first.
export function anchorHash(
  fileA: string,
  textA: string,
  fileB: string,
  textB: string
): string {
  const left = `${fileA}${SEP}${textA}`;
  const right = `${fileB}${SEP}${textB}`;
  const [lo, hi] = left <= right ? [left, right] : [right, left];
  return sha256(`${lo}${SEP}${hi}`);
}
