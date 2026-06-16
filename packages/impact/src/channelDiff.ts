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
  readonly change: "added" | "removed" | "changed" | "broken";
  // The current-truth channel: the AFTER state for added/changed/broken, the BEFORE
  // state for removed. Its memberships carry the cited anchors rendered as the proof.
  readonly channel: Channel;
  // Every shown membership's anchor re-found this run → drives the "Verified" pill.
  // A removed/broken channel is not a healthy verified channel, so it is never "verified".
  readonly verified: boolean;
  // For "broken": which side dropped out this session. "produce" = the provider is gone
  // and the surviving consumers now call a route nobody serves (the live break);
  // "consume" = the consumers are gone and the provider is left with no caller.
  readonly lostRole?: "produce" | "consume";
  // For "broken": the fully-wired BEFORE-state channel this degraded from.
  readonly priorChannel?: Channel;
};

function allVerified(channel: Channel): boolean {
  return channel.memberships.length > 0 && channel.memberships.every((m) => m.confidence === "verified");
}

// What sides a channel has. A healthy channel has both a provider and a consumer; a
// channel that lost one side this session is a break, not a new channel.
function wiring(channel: Channel): { readonly producer: boolean; readonly consumer: boolean } {
  return {
    producer: channel.memberships.some((m) => m.role === "produce" || m.role === "both"),
    consumer: channel.memberships.some((m) => m.role === "consume" || m.role === "both")
  };
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
      // A key not present before — a genuinely new channel.
      changes.push({ change: "added", channel, verified: allVerified(channel) });
    } else {
      // Same channel — identity is the normalized key (one channel per key), so a route
      // that lost a member keeps its id and lands here. Losing a WHOLE side this session
      // (the producer, or every consumer) is a BREAK, not a benign "changed": consumers
      // now call a route nobody serves, or a provider is left with no caller (§I3). A
      // member swap or anchor move that keeps both sides is a "changed".
      const wPrior = wiring(prior);
      const wNow = wiring(channel);
      const lostRole = wPrior.producer && !wNow.producer ? "produce" : wPrior.consumer && !wNow.consumer ? "consume" : undefined;
      if (lostRole) {
        changes.push({ change: "broken", channel, verified: false, lostRole, priorChannel: prior });
      } else if (channelAnchorHash(prior) !== channelAnchorHash(channel) || prior.kind !== channel.kind) {
        changes.push({ change: "changed", channel, verified: allVerified(channel) });
      }
    }
  }
  for (const [id, channel] of beforeById) {
    if (!afterById.has(id)) changes.push({ change: "removed", channel, verified: false });
  }

  // Deterministic order: broken first (the live risk), then added, changed, removed.
  const rank = { broken: 0, added: 1, changed: 2, removed: 3 } as const;
  changes.sort((a, b) => rank[a.change] - rank[b.change] || a.channel.key.localeCompare(b.channel.key));
  return changes;
}
