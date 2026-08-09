/**
 * Headers for Studio → Bridge HTTP calls.
 * Token mirrors Bridge: BRIDGE_HTTP_TOKEN || STUDIO_BRIDGE_TOKEN || BRIDGE_TOKEN
 */
export function bridgeHttpToken(): string {
  return (
    process.env.BRIDGE_HTTP_TOKEN ||
    process.env.STUDIO_BRIDGE_TOKEN ||
    process.env.BRIDGE_TOKEN ||
    ""
  ).trim();
}

export function bridgeAuthHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(extra || {}),
  };
  const token = bridgeHttpToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
