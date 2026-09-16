const SENSITIVE_KEY = /password|passcode|secret|api[_-]?key|authorization|cookie|session[_-]?id|access[_-]?token|refresh[_-]?token|client[_-]?secret/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function redactText(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
    .replace(/((?:authorization|cookie|session[_ -]?id|password|passcode|client[_ -]?secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]")
    .replace(/((?:account|routing)\s*(?:number|no\.?|#)?\s*[:=]\s*)\d{6,17}\b/gi, "$1[REDACTED]");
}

export function redactObservation(value: string): string {
  return redactText(value).replace(
    /(^\s*-\s+(?:textbox|combobox|spinbutton|searchbox)\b[^\n:]*:\s*)(?:"[^"\n]*"|[^\n]+)/gim,
    '$1"[REDACTED]"',
  );
}

export function redactValue<T>(value: T, key = ""): T {
  if (isSensitiveKey(key)) return "[REDACTED]" as T;
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]),
    ) as T;
  }
  return value;
}
