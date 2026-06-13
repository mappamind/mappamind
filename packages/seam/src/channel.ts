// Channel model — the vocabulary the channel tier (channelEdges.ts) and the model
// layer above it will speak once endpoints are reconciled into shared channels.
// These types are intentionally self-contained and not yet wired into detection:
// they are the contract the next slices fill in. No framework knowledge lives here;
// `kind`/`role`/`confidence` are filled by the model tier, not by string matching.

// What sort of conduit a channel is. "unknown" until the model commits.
export type ChannelKind = "http" | "queue" | "rpc" | "event" | "data" | "di" | "unknown";

// Which side a service plays on a channel: it produces, consumes, both, or we
// can't yet tell from structure alone.
export type EndpointRole = "produce" | "consume" | "both" | "unknown";

// A single grounded site: the exact string, the service it lives in, and where.
// Every channel claim must trace back to one of these — the leash rule.
export type AnchorRef = { readonly service: string; readonly file: string; readonly line: number; readonly text: string; };

// One service's participation in a channel, with the evidence and how sure we are.
export type ChannelMembership = { readonly service: string; readonly role: EndpointRole; readonly anchor: AnchorRef; readonly confidence: "verified" | "probable" | "possible"; };

// A reconciled channel: a stable key, its kind, every member, and a human rationale.
export type Channel = { readonly key: string; readonly kind: ChannelKind; readonly memberships: readonly ChannelMembership[]; readonly rationale: string; };

// The view a rendered edge needs: a directed link over a channel.
export type ChannelEdgeView = { readonly from: string; readonly to: string; readonly channelKey: string; readonly kind: ChannelKind; };

// A pre-reconciliation candidate: endpoints that share a key, how widespread the key
// is (ubiquity), and which tier proposed it.
export type ChannelCandidate = { readonly key: string; readonly endpoints: readonly AnchorRef[]; readonly ubiquity: number; readonly source: "string-match" | "contract-file" | "generic-rule"; };
