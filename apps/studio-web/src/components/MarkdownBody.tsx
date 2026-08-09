import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { unescapeLiteralNewlines } from "../work-orders/parseAgentOutput";

type Props = {
  content: string;
  className?: string;
};

/**
 * Markdown renderer for agent outputs.
 * remark-gfm: tables, strikethrough, task lists, autolinks.
 */
export function MarkdownBody({ content, className }: Props) {
  if (!content?.trim()) return null;
  const normalized = unescapeLiteralNewlines(content);
  return (
    <div className={`md-body ${className || ""}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Keep tables scrollable on narrow panels
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
