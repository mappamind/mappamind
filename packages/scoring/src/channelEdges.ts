// Bridge: verified Channels (seam) → ProducedChannelEdge[] the scorer grades.
//
// A channel is a node with M producers × N consumers; scoring compares flat,
// directed edges to labels. So we derive one consumer→producer edge per pair
// across services (the same derived view the renderer/graph use), carrying the
// cited producer/consumer files and the verified flag the poison-pill metric reads.

import type { Channel } from "@mappamind_/seam";

import type { ProducedChannelEdge } from "./channelScore.js";

export function channelsToScoredEdges(channels: readonly Channel[]): ProducedChannelEdge[] {
  const byKey = new Map<string, ProducedChannelEdge>();
  for (const channel of channels) {
    const producers = channel.memberships.filter((m) => m.role === "produce" || m.role === "both");
    const consumers = channel.memberships.filter((m) => m.role === "consume" || m.role === "both");
    for (const p of producers) {
      for (const c of consumers) {
        if (c.service === p.service) continue;
        // verified existence = BOTH cited anchors re-found this run; otherwise the
        // edge carries the weaker of the two model confidences.
        const confidence =
          p.confidence === "verified" && c.confidence === "verified"
            ? "verified"
            : p.confidence === "possible" || c.confidence === "possible"
              ? "possible"
              : "probable";
        // Dedupe by the directed pair + cited files: two distinct routes between the
        // same files (a consumer that hits several of a service's endpoints) are one
        // edge for scoring, not N identical rows. A "verified" sighting wins.
        const key = `${c.service}->${p.service}|${p.anchor.file}|${c.anchor.file}`;
        const existing = byKey.get(key);
        if (!existing || (existing.confidence !== "verified" && confidence === "verified")) {
          byKey.set(key, {
            from: c.service,
            to: p.service,
            kind: channel.kind,
            direction: "from-calls-to",
            confidence,
            producerFile: p.anchor.file,
            consumerFile: c.anchor.file
          });
        }
      }
    }
  }
  return [...byKey.values()];
}
