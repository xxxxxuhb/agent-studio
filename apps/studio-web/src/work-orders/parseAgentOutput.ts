/**
 * Normalize agent / Bridge step outputs for UI rendering.
 *
 * Real payloads are often nested:
 *   "```json\n{ \"result\": \"{ \\\"summary\\\": \\\"...\\\\n\\\" }\" }\n```"
 * i.e. Markdown fence → JSON → stringified JSON → Markdown summary.
 *
 * IMPORTANT: never unescape \\n / \\" on the whole blob before JSON.parse —
 * that corrupts valid JSON string literals.
 */

export type ParsedAgentOutput =
  | {
      kind: "structured";
      meta: Record<string, string>;
      body: string;
      restJson?: string;
    }
  | { kind: "markdown"; body: string }
  | { kind: "json"; body: string; pretty: string }
  | { kind: "text"; body: string };

const META_KEYS = [
  "runId",
  "run_id",
  "stage",
  "status",
  "agent",
  "title",
  "workflow_run_id",
  "task_id",
] as const;

const BODY_KEYS = [
  "summary",
  "result",
  "output",
  "content",
  "markdown",
  "text",
  "message",
  "raw",
] as const;

/** Unescape only narrative text (after JSON has already been parsed). */
export function unescapeLiteralNewlines(raw: string): string {
  const text = raw.trim();
  if (!text.includes("\\n") && !text.includes("\\t")) return text;
  const literalNl = (text.match(/\\n/g) || []).length;
  const realNl = (text.match(/\n/g) || []).length;
  // Single-line dumps with escaped newlines, or escaped newlines dominating.
  if (literalNl > 0 && (realNl === 0 || literalNl > realNl)) {
    return text
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  return text;
}

function tryParseJson(raw: string): unknown | undefined {
  const t = raw.trim();
  if (!(t.startsWith("{") || t.startsWith("[") || (t.startsWith('"') && t.length > 1))) {
    return undefined;
  }
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function looksLikeJsonText(text: string): boolean {
  const t = text.trim();
  return (
    (t.startsWith("{") && t.includes("}")) ||
    (t.startsWith("[") && t.includes("]"))
  );
}

function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6}\s/m.test(text) ||
    /\*\*[^*]+\*\*/.test(text) ||
    /^\s*[-*]\s+/m.test(text) ||
    /^\s*\|.+\|/m.test(text) ||
    /```/.test(text) ||
    /`[^`]+`/.test(text)
  );
}

/**
 * Recursively unwrap stringified JSON (Bridge nests `result` as a JSON string).
 */
function deepUnwrap(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!looksLikeJsonText(trimmed) && !(trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return value;
    }
    const parsed = tryParseJson(trimmed);
    if (parsed === undefined) return value;
    return deepUnwrap(parsed, depth + 1);
  }
  const obj = asRecord(value);
  if (obj) {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      next[k] = deepUnwrap(v, depth + 1);
    }
    return next;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepUnwrap(v, depth + 1));
  }
  return value;
}

function flattenPayload(value: unknown): Record<string, unknown> | undefined {
  const unwrapped = deepUnwrap(value);
  const obj = asRecord(unwrapped);
  if (!obj) return undefined;

  for (const key of BODY_KEYS) {
    const inner = asRecord(obj[key]);
    if (
      inner &&
      (typeof inner.summary === "string" ||
        typeof inner.result === "string" ||
        typeof inner.markdown === "string" ||
        typeof inner.content === "string")
    ) {
      return {
        ...inner,
        run_id: obj.run_id ?? obj.runId ?? inner.run_id ?? inner.runId,
        stage: obj.stage ?? inner.stage,
        status: obj.status ?? inner.status,
      };
    }
  }
  return obj;
}

function extractFencedPayload(raw: string): { preface: string; payload: string } | undefined {
  const fence =
    /```(?:json|JSON)?\s*\r?\n([\s\S]*?)```/.exec(raw) ||
    /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(raw);
  if (!fence?.[1]?.trim()) return undefined;
  return {
    preface: raw.slice(0, fence.index).trim(),
    payload: fence[1].trim(),
  };
}

function extractEmbeddedJson(raw: string): { preface: string; payload: string } | undefined {
  const start = raw.indexOf('{"');
  if (start < 0) return undefined;
  for (let end = raw.lastIndexOf("}"); end > start; end = raw.lastIndexOf("}", end - 1)) {
    const slice = raw.slice(start, end + 1);
    if (tryParseJson(slice) !== undefined) {
      return { preface: raw.slice(0, start).trim(), payload: slice };
    }
  }
  return undefined;
}

function pickBody(obj: Record<string, unknown>): string | undefined {
  for (const key of BODY_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) {
      const maybe = deepUnwrap(v);
      if (typeof maybe === "string") return maybe;
      const nested = asRecord(maybe);
      if (nested) {
        const nestedBody = pickBody(nested);
        if (nestedBody) return nestedBody;
      }
      return v;
    }
    const nested = asRecord(v);
    if (nested) {
      const nestedBody = pickBody(nested);
      if (nestedBody) return nestedBody;
    }
  }
  let best: string | undefined;
  for (const [key, value] of Object.entries(obj)) {
    if ((META_KEYS as readonly string[]).includes(key)) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    if (!looksLikeMarkdown(value)) continue;
    if (!best || value.length > best.length) best = value;
  }
  return best;
}

function structuredFromObject(obj: Record<string, unknown>): ParsedAgentOutput | undefined {
  const flat = flattenPayload(obj) || obj;
  const bodyRaw = pickBody(flat);
  const meta: Record<string, string> = {};
  for (const key of META_KEYS) {
    const v = flat[key];
    if (v !== undefined && v !== null && typeof v !== "object" && String(v).trim()) {
      meta[key] = String(v);
    }
  }
  if (!bodyRaw && !Object.keys(meta).length) return undefined;

  // JSON.parse already turned \\n into real newlines inside strings
  const body = unescapeLiteralNewlines(bodyRaw || "");
  const rest: Record<string, unknown> = { ...flat };
  for (const key of [...META_KEYS, ...BODY_KEYS]) delete rest[key];
  for (const [k, v] of Object.entries(rest)) {
    if (v === null || v === undefined) delete rest[k];
    if (typeof v === "string" && v === bodyRaw) delete rest[k];
    if (typeof v === "object") {
      const s = JSON.stringify(v);
      if (s.length > 400) delete rest[k];
    }
  }
  const restJson =
    Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : undefined;

  return {
    kind: "structured",
    meta,
    body,
    restJson,
  };
}

function fromJsonish(payload: string, preface = ""): ParsedAgentOutput | undefined {
  const parsed = tryParseJson(payload);
  if (parsed === undefined) return undefined;
  const obj = asRecord(deepUnwrap(parsed));
  if (!obj) return undefined;
  const structured = structuredFromObject(obj);
  if (!structured || structured.kind !== "structured") return undefined;

  const cleanPreface = preface.trim();
  if (cleanPreface && looksLikeMarkdown(cleanPreface) && structured.body) {
    return {
      ...structured,
      body: `${cleanPreface}\n\n${structured.body}`.trim(),
    };
  }
  if (!structured.body && cleanPreface) {
    return { ...structured, body: cleanPreface };
  }
  return structured;
}

export function parseAgentOutput(raw: string | null | undefined): ParsedAgentOutput {
  if (!raw || !raw.trim()) return { kind: "text", body: "" };

  // Keep original escaping for JSON.parse; only trim edges
  const source = raw.trim();

  const fenced = extractFencedPayload(source);
  if (fenced) {
    const hit = fromJsonish(fenced.payload, fenced.preface);
    if (hit) return hit;
  }

  const embedded = extractEmbeddedJson(source);
  if (embedded) {
    const hit = fromJsonish(embedded.payload, embedded.preface);
    if (hit) return hit;
  }

  const direct = fromJsonish(source);
  if (direct) return direct;

  const parsed = tryParseJson(source);
  if (Array.isArray(parsed)) {
    return { kind: "json", body: source, pretty: JSON.stringify(parsed, null, 2) };
  }
  if (asRecord(parsed)) {
    return {
      kind: "json",
      body: source,
      pretty: JSON.stringify(deepUnwrap(parsed), null, 2),
    };
  }

  const narrative = unescapeLiteralNewlines(source);
  if (looksLikeMarkdown(narrative)) {
    return { kind: "markdown", body: narrative };
  }
  return { kind: "text", body: narrative };
}
