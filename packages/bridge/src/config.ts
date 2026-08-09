import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { AgentsConfigSchema, type AgentsConfig } from "./types.js";

export function loadAgentsConfig(agentsMdPath: string): {
  config: AgentsConfig;
  body: string;
  absolutePath: string;
} {
  const absolutePath = path.resolve(agentsMdPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`AGENTS.md not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = matter(raw);
  const config = AgentsConfigSchema.parse(parsed.data);
  const agentsDir = path.dirname(absolutePath);
  // Allow relative repo_path relative to AGENTS.md directory
  if (!path.isAbsolute(config.project.repo_path)) {
    config.project.repo_path = path.resolve(agentsDir, config.project.repo_path);
  }
  // Stale absolute repo_path (copied from another machine / old clone):
  // when AGENTS.md lives at a git root that differs from configured repo_path, prefer that root.
  const configured = path.resolve(config.project.repo_path);
  if (
    path.basename(absolutePath).toLowerCase() === "agents.md" &&
    configured !== path.resolve(agentsDir) &&
    fs.existsSync(path.join(agentsDir, ".git"))
  ) {
    config.project.repo_path = agentsDir;
  }
  return { config, body: parsed.content, absolutePath };
}

export function resolveRunPath(
  template: string,
  runId: string,
  repoPath: string,
): string {
  const rel = template.replaceAll("{run_id}", runId);
  return path.isAbsolute(rel) ? rel : path.join(repoPath, rel);
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeText(filePath: string, content: string): void {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

export function readTextIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

export function writeStageArtifact(filePath: string, content: string): void {
  writeText(filePath, content.endsWith("\n") ? content : `${content}\n`);
}

export function assertProductionDisabled(config: AgentsConfig): void {
  if (String(config.release.production).toLowerCase() !== "disabled") {
    throw new Error(
      "Refusing to continue: release.production must be 'disabled' in phase-1",
    );
  }
}
