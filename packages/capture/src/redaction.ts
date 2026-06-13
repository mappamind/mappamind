import type { EvidenceRedactionState, JsonValue } from "@mappamind_/core";

export type RedactionResult<T> = {
  readonly value: T;
  readonly redactionState: EvidenceRedactionState;
  readonly redactionCount: number;
};

const SECRET_VALUE_PLACEHOLDER = "[REDACTED_SECRET]";

const SECRET_ASSIGNMENT =
  /\b([A-Z0-9_.-]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_.-]*)(\s*[:=]\s*)(["']?)([^\s"',}]+)(\3)/gi;

const SECRET_JSON_ASSIGNMENT =
  /(["'])([A-Z0-9_.-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|private[_-]?key)[A-Z0-9_.-]*)\1(\s*:\s*)(["'])([^"']+)(\4)/gi;

const AUTHORIZATION_BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g;

const SECRET_TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bghp_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g
];

function stateForCount(count: number): EvidenceRedactionState {
  return count > 0 ? "redacted" : "not_required";
}

export function redactText(value: string): RedactionResult<string> {
  let redactionCount = 0;
  let redacted = value.replace(
    SECRET_JSON_ASSIGNMENT,
    (_match, quote: string, key: string, separator: string, valueQuote: string, _secret: string) => {
      redactionCount += 1;
      return `${quote}${key}${quote}${separator}${valueQuote}${SECRET_VALUE_PLACEHOLDER}${valueQuote}`;
    }
  );
  redacted = redacted.replace(
    SECRET_ASSIGNMENT,
    (_match, key: string, separator: string, quote: string, _secret: string, endQuote: string) => {
      redactionCount += 1;
      return `${key}${separator}${quote}${SECRET_VALUE_PLACEHOLDER}${endQuote}`;
    }
  );
  redacted = redacted.replace(AUTHORIZATION_BEARER, (_match, prefix: string) => {
    redactionCount += 1;
    return `${prefix}${SECRET_VALUE_PLACEHOLDER}`;
  });
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, () => {
      redactionCount += 1;
      return SECRET_VALUE_PLACEHOLDER;
    });
  }

  return {
    value: redacted,
    redactionState: stateForCount(redactionCount),
    redactionCount
  };
}

export function redactJsonValue(value: JsonValue): RedactionResult<JsonValue> {
  if (typeof value === "string") {
    return redactText(value);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return {
      value,
      redactionState: "not_required",
      redactionCount: 0
    };
  }
  if (Array.isArray(value)) {
    let redactionCount = 0;
    const redactedItems = value.map((item) => {
      const redacted = redactJsonValue(item);
      redactionCount += redacted.redactionCount;
      return redacted.value;
    });
    return {
      value: redactedItems,
      redactionState: stateForCount(redactionCount),
      redactionCount
    };
  }

  let redactionCount = 0;
  const redactedEntries = Object.entries(value).map(([key, item]) => {
    const redacted = redactJsonValue(item);
    redactionCount += redacted.redactionCount;
    return [key, redacted.value] as const;
  });

  return {
    value: Object.fromEntries(redactedEntries),
    redactionState: stateForCount(redactionCount),
    redactionCount
  };
}
