import type { RunLogEntry } from "@agent-studio/agent-schema";

/** Operator-facing mini timeline derived from durable run-log entries. */
export type RunLogTraceStep = {
  at: string;
  kind: string;
  label: string;
  level?: string;
  bridge_stage?: string;
  event_type?: string;
};

const KEY_EVENT_TYPES = new Set([
  "run_started",
  "bridge_stage",
  "human_input_required",
  "human_decision",
  "run_finished",
  "sync_error",
]);

/** True when `q` looks like a Studio / Bridge / work-order id (not free text). */
export function looksLikeCorrelationId(q: string): boolean {
  const s = q.trim();
  if (s.length < 4 || s.length > 96) return false;
  if (/\s/.test(s)) return false;
  return /^[a-zA-Z0-9._:@/-]+$/.test(s);
}

/**
 * Collapse entries into an ordered stage/event trace for ops follow-through.
 * Dedupes repeated bridge stages; keeps key event types and warn/error lines.
 */
export function buildRunLogTrace(entries: RunLogEntry[]): RunLogTraceStep[] {
  const steps: RunLogTraceStep[] = [];
  const seenStages = new Set<string>();
  const seenKeys = new Set<string>();

  for (const e of entries) {
    const stage = (e.bridge_stage || "").trim();
    if (stage && !seenStages.has(stage)) {
      seenStages.add(stage);
      const key = `stage:${stage}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        steps.push({
          at: e.at,
          kind: "bridge_stage",
          label: stage,
          level: e.level,
          bridge_stage: stage,
          event_type: e.event_type,
        });
      }
      continue;
    }

    const eventType = (e.event_type || "").trim();
    if (eventType && KEY_EVENT_TYPES.has(eventType) && eventType !== "bridge_stage") {
      const key = `event:${eventType}:${e.message.slice(0, 40)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      steps.push({
        at: e.at,
        kind: eventType,
        label: e.message.replace(/\s+/g, " ").trim().slice(0, 120),
        level: e.level,
        event_type: eventType,
      });
      continue;
    }

    if (e.level === "error" || e.level === "warn") {
      const key = `lvl:${e.level}:${e.message.slice(0, 40)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      steps.push({
        at: e.at,
        kind: e.level,
        label: e.message.replace(/\s+/g, " ").trim().slice(0, 120),
        level: e.level,
        event_type: eventType || undefined,
      });
    }
  }

  return steps;
}
