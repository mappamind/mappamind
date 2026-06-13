// The channel diff: what the session did to the VERIFIED channels (plan Phase 6).
//
// meshDiff works on flattened ServiceEdges (from/to/contract) — enough for severity
// and broken-contract detection, but it has thrown away the cited anchors. The card's
// hero needs the proof: the exact producer/consumer spans. So we diff at the channel
// level, where every membership still carries its re-found AnchorRef. Identity is
// content-addressed (channelId), so the diff is a true set-delta, not model mood.

import type { Channel } from "@mappamind_/seam";
import { channelAnchorHash, channelId } from "@mappamind_/seam";

export type ChannelChange = {
  readonly change: "added" | "removed" | "changed";
  // The current-truth channel: the AFTER state for added/changed, the BEFORE state
  // for removed. Its memberships carry the cited anchors rendered as the proof.
  readonly channel: Channel;
  // Every shown membership's anchor re-found this run → drives the "Verified" pill.
  // A removed channel is not present after, so it is never "verified".
  readonly verified: boolean;
};

function allVerified(channel: Channel): boolean {
  return channel.memberships.length > 0 && channel.memberships.every((m) => m.confidence === "verified");
}

export function diffChannels(
  before: readonly Channel[],
  after: readonly Channel[]
): ChannelChange[] {
  const beforeById = new Map(before.map((c) => [channelId(c), c]));
  const afterById = new Map(after.map((c) => [channelId(c), c]));
  const changes: ChannelChange[] = [];

  for (const [id, channel] of afterById) {
    const prior = beforeById.get(id);
    if (!prior) {
      changes.push({ change: "added", channel, verified: allVerified(channel) });
    } else if (channelAnchorHash(prior) !== channelAnchorHash(channel) || prior.kind !== channel.kind) {
      changes.push({ change: "changed", channel, verified: allVerified(channel) });
    }
  }
  for (const [id, channel] of beforeById) {
    if (!afterById.has(id)) changes.push({ change: "removed", channel, verified: false });
  }

  // Deterministic order: added, changed, removed — then by channel key.
  const rank = { added: 0, changed: 1, removed: 2 } as const;
  changes.sort((a, b) => rank[a.change] - rank[b.change] || a.channel.key.localeCompare(b.channel.key));
  return changes;
}
