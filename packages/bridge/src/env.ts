import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Load .env from cwd and ~/.agent-studio/bridge.env (does not override existing env). */
export function loadDotEnv(extraFiles: string[] = []) {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), ".agent-studio", "bridge.env"),
    ...extraFiles,
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
