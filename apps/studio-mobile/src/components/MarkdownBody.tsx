import { StyleSheet, Text, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { colors } from "../theme";

function unescapeLiteralNewlines(raw: string): string {
  if (!raw) return "";
  // Only when the blob looks like escaped text (common agent dump), not real JSON.
  if (!raw.includes("\\n") && !raw.includes("\\t")) return raw;
  if (raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")) {
    return raw;
  }
  return raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function pretifyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/** Prefer markdown body from Bridge JSON wrappers when present. */
function extractDisplayBody(raw: string): { mode: "md" | "code"; text: string } {
  const normalized = unescapeLiteralNewlines(raw || "").trim();
  if (!normalized) return { mode: "md", text: "" };

  if (looksLikeJson(normalized)) {
    try {
      const obj = JSON.parse(normalized) as Record<string, unknown>;
      for (const key of ["summary", "result", "output", "content", "markdown", "text"]) {
        const v = obj[key];
        if (typeof v === "string" && v.trim()) {
          const inner = unescapeLiteralNewlines(v).trim();
          if (looksLikeJson(inner)) {
            try {
              const nested = JSON.parse(inner) as Record<string, unknown>;
              for (const k of ["summary", "markdown", "content", "text"]) {
                if (typeof nested[k] === "string" && String(nested[k]).trim()) {
                  return {
                    mode: "md",
                    text: unescapeLiteralNewlines(String(nested[k])),
                  };
                }
              }
            } catch {
              /* fall through */
            }
          }
          return { mode: "md", text: inner };
        }
      }
      return { mode: "code", text: pretifyJson(normalized) };
    } catch {
      /* fall through to md */
    }
  }

  // Fenced json → try peel
  const fence = normalized.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fence?.[1]?.trim()) {
    return extractDisplayBody(fence[1]);
  }

  return { mode: "md", text: normalized };
}

type Props = {
  content: string | null | undefined;
  /** Force monospace code block (e.g. non-md artifact). */
  forceCode?: boolean;
};

export function MarkdownBody({ content, forceCode }: Props) {
  const raw = String(content || "").trim();
  if (!raw) {
    return <Text style={styles.empty}>—</Text>;
  }

  const { mode, text } = forceCode
    ? { mode: "code" as const, text: raw }
    : extractDisplayBody(raw);

  if (mode === "code") {
    return (
      <View style={styles.codeWrap}>
        <Text style={styles.code} selectable>
          {text}
        </Text>
      </View>
    );
  }

  return (
    <Markdown style={mdStyles} mergeStyle>
      {text}
    </Markdown>
  );
}

/** Heuristic: render as MD unless clearly binary-ish / forced plain. */
export function shouldRenderMarkdown(
  nameOrType: string,
  content: string,
): boolean {
  const n = (nameOrType || "").toLowerCase();
  if (
    n.includes("markdown") ||
    n.endsWith(".md") ||
    n.endsWith(".markdown") ||
    n.includes("text/")
  ) {
    return true;
  }
  if (
    n.includes("json") ||
    n.endsWith(".json") ||
    n.includes("octet") ||
    n.includes("image/")
  ) {
    return false;
  }
  // Content sniff
  return (
    /^#{1,6}\s/m.test(content) ||
    /```/.test(content) ||
    /^\s*[-*+]\s/m.test(content) ||
    /\*\*[^*]+\*\*/.test(content) ||
    content.includes("\n\n")
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, fontSize: 15 },
  codeWrap: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  code: {
    fontFamily: "Courier",
    fontSize: 12,
    lineHeight: 18,
    color: colors.text,
  },
});

const mdStyles = StyleSheet.create({
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  heading1: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 6,
  },
  heading2: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 4,
  },
  heading3: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginTop: 6,
    marginBottom: 4,
  },
  paragraph: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 0,
    marginBottom: 8,
  },
  strong: { fontWeight: "700", color: colors.text },
  em: { fontStyle: "italic" },
  link: { color: colors.primary },
  blockquote: {
    backgroundColor: colors.bg,
    borderLeftColor: colors.primary,
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 6,
  },
  code_inline: {
    backgroundColor: colors.bg,
    borderRadius: 4,
    paddingHorizontal: 4,
    fontFamily: "Courier",
    fontSize: 13,
    color: colors.text,
  },
  fence: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginVertical: 8,
    fontFamily: "Courier",
    fontSize: 12,
    color: colors.text,
  },
  code_block: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 10,
    fontFamily: "Courier",
    fontSize: 12,
  },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginVertical: 2 },
  hr: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  table: { borderColor: colors.border, borderWidth: 1, marginVertical: 8 },
  tr: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  th: { padding: 6, fontWeight: "700", backgroundColor: colors.bg },
  td: { padding: 6 },
});
