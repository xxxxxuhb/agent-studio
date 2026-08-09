import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Resolve an executable from env override or PATH. */
export function resolveExecutable(
  candidates: string[],
  envKeys: string[] = [],
): string | null {
  for (const key of envKeys) {
    const v = process.env[key]?.trim();
    if (v && fs.existsSync(v)) return v;
  }
  const whichCmd = process.platform === "win32" ? "where" : "which";
  for (const name of candidates) {
    try {
      const out = execFileSync(whichCmd, [name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split(/\r?\n/)[0];
      if (out) return out;
    } catch {
      /* try next */
    }
  }
  return null;
}

export type SpawnCaptureResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export function spawnCapture(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  },
): Promise<SpawnCaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            reject(
              new Error(
                `Command timed out after ${opts.timeoutMs}ms: ${command} ${args.join(" ")}`,
              ),
            );
          }, opts.timeoutMs)
        : null;

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export function writeTempPromptFile(cwd: string, prompt: string): string {
  const dir = path.join(cwd, ".agent-studio");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `prompt-${Date.now()}.txt`);
  fs.writeFileSync(file, prompt, "utf8");
  return file;
}
