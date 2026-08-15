export type MentionUser = {
  id: string;
  username?: string | null;
  display_name?: string | null;
};

export type ParsedUserMention = {
  id: string;
  name: string;
};

export type ParseUserMentionsResult = {
  mentioned: ParsedUserMention[];
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve `@username` / `@display_name` / `@user_id` against team members.
 * Longer tokens win; order follows first appearance in text.
 */
export function parseUserMentions(
  text: string,
  users: MentionUser[],
): ParseUserMentionsResult {
  type Hit = ParsedUserMention & { index: number };
  const hits: Hit[] = [];
  const seen = new Set<string>();

  const candidates = users
    .flatMap((u) => {
      const id = String(u.id || "").trim();
      if (!id) return [];
      const username = String(u.username || "").trim();
      const display = String(u.display_name || "").trim();
      const name = display || username || id;
      const rows = [{ id, name, token: id }];
      if (username && username !== id) rows.push({ id, name, token: username });
      if (display && display !== id && display !== username) {
        rows.push({ id, name, token: display });
      }
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
  return {
    mentioned: hits.map(({ id, name }) => ({ id, name })),
  };
}
