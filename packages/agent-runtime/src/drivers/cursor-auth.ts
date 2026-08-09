import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Cursor } from "@cursor/sdk";

function storedAuthPath() {
  return path.join(os.homedir(), ".cursor", "sdk", "auth.json");
}

/** True when CURSOR_API_KEY is set or SDK browser-login credentials exist. */
export function hasCursorCredentials(): boolean {
  if (process.env.CURSOR_API_KEY?.trim()) return true;
  try {
    return fs.existsSync(storedAuthPath());
  } catch {
    return false;
  }
}

/**
 * Ensure Cursor SDK can run:
 * 1. CURSOR_API_KEY
 * 2. existing ~/.cursor/sdk/auth.json from a previous login
 * 3. optional interactive Cursor.auth.login() when login=true
 */
export async function ensureCursorAuth(opts: {
  login?: boolean;
}): Promise<"env" | "stored" | "login"> {
  if (process.env.CURSOR_API_KEY?.trim()) return "env";

  try {
    const status = await Cursor.auth.status();
    if (status.status === "logged-in") return "stored";
  } catch {
    if (hasCursorCredentials()) return "stored";
  }

  if (!opts.login) {
    throw new Error(
      "Cursor credentials missing. Set CURSOR_API_KEY, or pass --login to open a browser login (Cursor.auth.login).",
    );
  }

  console.log("Opening browser for Cursor SDK login…");
  await Cursor.auth.login({
    apiKeyName: "agent-studio-bridge",
    onLoginUrl: (url) => {
      console.log(`If the browser did not open, visit:\n  ${url}`);
    },
  });
  return "login";
}
