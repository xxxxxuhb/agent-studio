import fs from "node:fs";
import path from "node:path";
import { loadAgentsConfig } from "./config.js";
import type { AgentsConfig } from "./types.js";

export type RepoRole =
  | "frontend"
  | "backend"
  | "fullstack"
  | "docs"
  | "infra"
  | "unknown";

export interface WorkspaceCandidate {
  agentsMdPath: string;
  config: AgentsConfig;
  role: RepoRole;
  score: number;
  reasons: string[];
}

export interface RouteDecision {
  agentsMdPath: string;
  repoPath: string;
  projectName: string;
  role: RepoRole;
  score: number;
  reasons: string[];
  candidates: Array<{
    projectName: string;
    role: RepoRole;
    agentsMdPath: string;
    score: number;
  }>;
  overriddenHint?: string;
}

const FRONTEND_TERMS = [
  "前端",
  "frontend",
  "vue",
  "element",
  "vite",
  "axios",
  "页面",
  "ui",
  "css",
  "组件",
  "组件库",
  "浏览器",
  "localstorage",
  "登录页",
  "注册页",
  "fetch",
  "spa",
  "pinia",
  "router",
  "webpack",
  "antd",
  "react",
];

const BACKEND_TERMS = [
  "后端",
  "backend",
  "nestjs",
  "nest",
  "mysql",
  "typeorm",
  "postgres",
  "数据库",
  "jwt",
  "controller",
  "service",
  "dto",
  "orm",
  "api 服务",
  "接口实现",
  "swagger",
  "redis",
];

function inferRole(config: AgentsConfig, agentsBody: string): RepoRole {
  if (config.project.role) return config.project.role;
  const text = `${config.project.name}\n${agentsBody}`.toLowerCase();
  const fe = FRONTEND_TERMS.some((t) => text.includes(t.toLowerCase()));
  const be = BACKEND_TERMS.some((t) => text.includes(t.toLowerCase()));
  if (fe && be) return "fullstack";
  if (fe) return "frontend";
  if (be) return "backend";
  return "unknown";
}

function countHits(text: string, terms: string[]): { hits: string[]; score: number } {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const term of terms) {
    if (lower.includes(term.toLowerCase())) hits.push(term);
  }
  return { hits, score: hits.length };
}

function defaultWorkspaceRoots(): string[] {
  // No bundled example repos — require explicit roots or project binding.
  return [];
}

function discoverAgentsMdFiles(): string[] {
  const fromEnv = (process.env.BRIDGE_AGENTS_PATHS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv.map((p) => path.resolve(p));

  const roots = (process.env.BRIDGE_WORKSPACE_ROOTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const searchRoots = roots.length ? roots : defaultWorkspaceRoots();

  const found: string[] = [];
  for (const root of searchRoots) {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs)) continue;
    walkForAgents(abs, found, 0);
  }
  return [...new Set(found)];
}

function walkForAgents(dir: string, out: string[], depth: number): void {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist") {
      continue;
    }
    const full = path.join(dir, ent.name);
    if (ent.isFile() && ent.name === "AGENTS.md") {
      out.push(full);
    } else if (ent.isDirectory()) {
      walkForAgents(full, out, depth + 1);
    }
  }
}

function scoreCandidate(
  requirement: string,
  candidate: { agentsMdPath: string; config: AgentsConfig; role: RepoRole },
): WorkspaceCandidate {
  const reasons: string[] = [];
  let score = 0;
  const req = requirement.trim();
  const { hits: feHits, score: feScore } = countHits(req, FRONTEND_TERMS);
  const { hits: beHits, score: beScore } = countHits(req, BACKEND_TERMS);

  if (candidate.role === "frontend") {
    score += feScore * 3;
    if (feHits.length) reasons.push(`frontend terms: ${feHits.slice(0, 6).join(", ")}`);
    score -= beScore;
  } else if (candidate.role === "backend") {
    score += beScore * 3;
    if (beHits.length) reasons.push(`backend terms: ${beHits.slice(0, 6).join(", ")}`);
    score -= feScore;
  } else if (candidate.role === "fullstack") {
    score += Math.max(feScore, beScore);
  }

  const name = candidate.config.project.name.toLowerCase();
  if (name && req.toLowerCase().includes(name)) {
    score += 8;
    reasons.push(`mentions project name "${candidate.config.project.name}"`);
  }
  const repo = candidate.config.project.repo_path.toLowerCase();
  if (repo && req.toLowerCase().includes(path.basename(repo).toLowerCase())) {
    score += 5;
    reasons.push(`mentions repo "${path.basename(repo)}"`);
  }
  if (candidate.role !== "unknown") {
    reasons.push(`role=${candidate.role}`);
  }

  score += candidate.role === "frontend" ? 0.02 : candidate.role === "backend" ? 0.01 : 0;

  return {
    agentsMdPath: candidate.agentsMdPath,
    config: candidate.config,
    role: candidate.role,
    score,
    reasons,
  };
}

function loadCatalog(): Array<{
  agentsMdPath: string;
  config: AgentsConfig;
  role: RepoRole;
}> {
  const paths = discoverAgentsMdFiles();
  const out: Array<{ agentsMdPath: string; config: AgentsConfig; role: RepoRole }> = [];
  for (const p of paths) {
    try {
      const { config, body, absolutePath } = loadAgentsConfig(p);
      out.push({
        agentsMdPath: absolutePath,
        config,
        role: inferRole(config, body),
      });
    } catch {
      /* skip invalid */
    }
  }
  return out;
}

export function resolveWorkspaceTarget(input: {
  rawRequirement: string;
  agentsMdHint?: string;
}): RouteDecision {
  const catalog = loadCatalog();
  if (!catalog.length) {
    throw new Error(
      "No AGENTS.md found. Bind a Studio project, or set BRIDGE_AGENTS_PATHS / BRIDGE_WORKSPACE_ROOTS",
    );
  }

  const scored = catalog
    .map((c) => scoreCandidate(input.rawRequirement, c))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  const hint = (input.agentsMdHint || "").trim();
  const autoHints = new Set(["", "auto", "auto:", "workspace", "detect"]);

  let chosen = best;
  let overriddenHint: string | undefined;

  if (hint && !autoHints.has(hint.toLowerCase())) {
    const absHint = path.resolve(hint);
    const hinted =
      scored.find((c) => c.agentsMdPath === absHint) ||
      (() => {
        try {
          const { config, body, absolutePath } = loadAgentsConfig(absHint);
          return scoreCandidate(input.rawRequirement, {
            agentsMdPath: absolutePath,
            config,
            role: inferRole(config, body),
          });
        } catch {
          return undefined;
        }
      })();

    if (hinted) {
      // Absolute AGENTS.md from Studio Manager must win — never keyword-override.
      // (HTTP clients often drop routing_mode=explicit; auto path used to ignore m-back.)
      chosen = hinted;
    }
  }

  return {
    agentsMdPath: chosen.agentsMdPath,
    repoPath: chosen.config.project.repo_path,
    projectName: chosen.config.project.name,
    role: chosen.role,
    score: chosen.score,
    reasons: chosen.reasons,
    overriddenHint,
    candidates: scored.map((c) => ({
      projectName: c.config.project.name,
      role: c.role,
      agentsMdPath: c.agentsMdPath,
      score: Number(c.score.toFixed(2)),
    })),
  };
}
