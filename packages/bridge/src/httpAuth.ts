import type { FastifyReply, FastifyRequest } from "fastify";

/** Shared secret for Bridge HTTP (Dify / Studio → Bridge). */
export function bridgeHttpToken(): string {
  return (
    process.env.BRIDGE_HTTP_TOKEN ||
    process.env.STUDIO_BRIDGE_TOKEN ||
    process.env.BRIDGE_TOKEN ||
    ""
  ).trim();
}

export function extractRequestToken(req: FastifyRequest): string {
  const auth = String(req.headers.authorization || "").trim();
  if (/^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }
  const x = req.headers["x-bridge-token"];
  if (typeof x === "string" && x.trim()) return x.trim();
  if (Array.isArray(x) && x[0]) return String(x[0]).trim();
  return "";
}

/**
 * When a token is configured, require Bearer or X-Bridge-Token on all routes
 * except GET /health.
 */
export async function requireBridgeHttpAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const expected = bridgeHttpToken();
  if (!expected) return;

  const path = (req.url || "").split("?")[0];
  if (req.method === "GET" && (path === "/health" || path === "/")) {
    return;
  }

  const got = extractRequestToken(req);
  if (!got || got !== expected) {
    // Use 400 (not 401/403): Dify's ssrf_proxy client treats any 401/403 that
    // passes through Squid (Via: squid) as "blocked by SSRF protection", which
    // hides the real Bridge HTTP auth failure from workflow users.
    return reply.code(400).send({
      error: "unauthorized",
      message:
        "Bridge HTTP auth required: Authorization: Bearer <token> or X-Bridge-Token",
    });
  }
}
