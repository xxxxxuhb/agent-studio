import { CursorAgentDriver } from "./drivers/cursor.js";
import { OpenAIAgentDriver } from "./drivers/openai.js";
import { QoderAgentDriver } from "./drivers/qoder.js";
import { TraeAgentDriver } from "./drivers/trae.js";
import type { AgentDriver, AgentDriverId } from "./types.js";

const registry = new Map<string, () => AgentDriver>([
  ["cursor", () => new CursorAgentDriver()],
  ["openai", () => new OpenAIAgentDriver()],
  ["trae", () => new TraeAgentDriver()],
  ["qoder", () => new QoderAgentDriver()],
]);

/** Register a custom driver factory (id must be unique). */
export function registerAgentDriver(id: string, factory: () => AgentDriver) {
  registry.set(id, factory);
}

export function listAgentDriverIds(): string[] {
  return [...registry.keys()];
}

function firstAvailable(ids: string[]): AgentDriver | null {
  for (const id of ids) {
    const factory = registry.get(id);
    if (!factory) continue;
    const driver = factory();
    if (driver.isAvailable()) return driver;
  }
  return null;
}

/**
 * Resolve the active agent driver.
 *
 * Env:
 * - AGENT_DRIVER=auto|cursor|openai|trae|qoder|<custom>
 * - auto → first available among cursor, trae, qoder
 */
export function resolveAgentDriver(preferred?: string): AgentDriver {
  const raw = (preferred || process.env.AGENT_DRIVER || "auto").trim().toLowerCase();
  if (raw === "dry-run") {
    throw new Error(
      "AGENT_DRIVER=dry-run was removed. Use cursor, trae, or qoder.",
    );
  }
  const id = (raw || "auto") as AgentDriverId;

  if (id === "auto") {
    const picked = firstAvailable(["cursor", "trae", "qoder"]);
    if (picked) return picked;
    throw new Error(
      `No agent driver available. Configure one of: cursor (CURSOR_API_KEY or --login), trae (traecli), qoder (QODER_PERSONAL_ACCESS_TOKEN). Available ids: ${listAgentDriverIds().join(", ")}`,
    );
  }

  const factory = registry.get(id);
  if (!factory) {
    throw new Error(
      `Unknown AGENT_DRIVER="${id}". Available: auto, ${listAgentDriverIds().join(", ")}`,
    );
  }
  const driver = factory();
  if (!driver.isAvailable()) {
    throw new Error(
      `Agent driver "${id}" is not available under current environment (missing CLI/API key or misconfigured)`,
    );
  }
  return driver;
}

export function describeActiveDriver(): {
  id: string;
  label: string;
  dryRun: boolean;
  model?: string;
} {
  const driver = resolveAgentDriver();
  return {
    id: driver.id,
    label: driver.label,
    dryRun: false,
    model:
      process.env.AGENT_MODEL ||
      process.env.CURSOR_MODEL ||
      process.env.QODER_MODEL ||
      process.env.OPENAI_MODEL ||
      undefined,
  };
}
