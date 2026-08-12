export type MentionAgent = {
  id: string;
  name?: string | null;
};

export type ParsedMention = {
  id: string;
  name: string;
};

export type ParseAgentMentionsResult = {
  mentioned: ParsedMention[];
  /** First @ hit in text order — primary agent to execute. */
  primary: ParsedMention | null;
  others: ParsedMention[];
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve `@id` / `@name` against digital humans.
 * Longer tokens win at each position so `@requirement_intake` beats `@requirement`.
 * Primary = earliest match in the original text.
 */
export function parseAgentMentions(
  text: string,
  agents: MentionAgent[],
): ParseAgentMentionsResult {
  type Hit = ParsedMention & { index: number };
  const hits: Hit[] = [];
  const seen = new Set<string>();

  const candidates = agents
    .flatMap((a) => {
      const id = String(a.id || "").trim();
      if (!id) return [];
      const name = String(a.name || "").trim() || id;
      const rows = [{ id, name, token: id }];
      if (name !== id) rows.push({ id, name, token: name });
      return rows;
    })
    .sort((a, b) => b.token.length - a.token.length);

  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    const re = new RegExp(`@${escapeRegExp(c.token)}(?![\\w-])`, "ig");
    const m = re.exec(text);
    if (!m || m.index < 0) continue;
    seen.add(c.id);
    hits.push({ id: c.id, name: c.name, index: m.index });
  }

  hits.sort((a, b) => a.index - b.index);
  const mentioned = hits.map(({ id, name }) => ({ id, name }));
  return {
    mentioned,
    primary: mentioned[0] || null,
    others: mentioned.slice(1),
  };
}
