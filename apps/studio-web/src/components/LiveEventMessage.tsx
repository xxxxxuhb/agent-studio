import { useEffect, useState, type ReactNode } from "react";
import { Modal, Spin, Typography, message } from "antd";
import type { Components } from "react-markdown";
import { runLogsApi } from "../api/run-logs";
import { AgentOutputView } from "./AgentOutputView";
import { MarkdownBody } from "./MarkdownBody";

const DOC_EXT = String.raw`(?:md|markdown|txt|json|ya?ml)`;
/** Run artifact paths under docs/(dify-)runs/... */
const RUN_DOC_PATH =
  String.raw`docs\/(?:dify-)?runs\/[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+\.${DOC_EXT}`;

const BARE_RUN_DOC_RE = new RegExp(
  String.raw`(^|[\s(（【\[])(${RUN_DOC_PATH})(?=$|[\s)）】\].,;:!?，。；：！？])`,
  "gi",
);

export function isDocPathRef(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Only run 产物 paths are fetchable via artifacts API.
  if (new RegExp(String.raw`^${RUN_DOC_PATH}$`, "i").test(t)) return true;
  // Also allow bare artifact filenames commonly written under the run dir.
  return /^(requirement|plan|clarify|clarification|review|test|ops|summary|design)(_[a-z0-9]+)?\.(md|markdown|txt|json|ya?ml)$/i.test(
    t,
  );
}

/** Basename used by Bridge artifacts API. */
export function artifactNameFromPath(path: string): string {
  const cleaned = path.trim().replace(/^`+|`+$/g, "");
  const parts = cleaned.split(/[/\\]/);
  return parts[parts.length - 1] || cleaned;
}

/** Ensure bare run-doc paths are backtick-wrapped for Markdown code spans. */
export function wrapDocPathsForMarkdown(text: string): string {
  return text.replace(BARE_RUN_DOC_RE, "$1`$2`");
}

type DocLinkProps = {
  path: string;
  onOpen: (path: string) => void;
  children?: ReactNode;
};

export function DocPathLink({ path, onOpen, children }: DocLinkProps) {
  return (
    <button
      type="button"
      className="doc-path-link"
      title="点击查看文档"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen(path);
      }}
    >
      {children ?? path}
    </button>
  );
}

type MessageProps = {
  message: string;
  /** When set with onOpenDoc, paths become links. */
  onOpenDoc?: (path: string) => void;
};

/**
 * Renders a live-event message as Markdown; document paths become clickable
 * when onOpenDoc is provided (parent shows ArtifactDocModal).
 */
export function LiveEventMessage({ message: raw, onOpenDoc }: MessageProps) {
  if (!raw?.trim()) return null;

  const content = wrapDocPathsForMarkdown(raw);

  const components: Components | undefined = onOpenDoc
    ? {
        code: ({ className, children, ...rest }) => {
          const text = String(children).replace(/\n$/, "");
          const isBlock = Boolean(className) || text.includes("\n");
          if (!isBlock && isDocPathRef(text)) {
            return (
              <DocPathLink path={text} onOpen={onOpenDoc}>
                {text}
              </DocPathLink>
            );
          }
          return (
            <code className={className} {...rest}>
              {children}
            </code>
          );
        },
      }
    : undefined;

  return (
    <div className="wo-live-event-msg">
      <MarkdownBody
        content={content}
        className="wo-live-event-md"
        components={components}
      />
    </div>
  );
}

type ModalProps = {
  open: boolean;
  path: string | null;
  runId?: string;
  onClose: () => void;
};

export function ArtifactDocModal({ open, path, runId, onClose }: ModalProps) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const name = path ? artifactNameFromPath(path) : "";

  useEffect(() => {
    if (!open || !runId || !name) {
      setContent("");
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setContent("");
    void runLogsApi
      .readArtifact(runId, name)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content || "");
      })
      .catch((err) => {
        if (cancelled) return;
        const raw = err instanceof Error ? err.message : String(err);
        const msg = /artifact not found/i.test(raw)
          ? `${name} 本次 run 未落盘（Bridge 与入库均无）。Agent 若未写出该文件，预览会失败；请在「产物」里打开已存在的文件。`
          : raw;
        setError(msg);
        message.error(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, runId, name]);

  return (
    <Modal
      title={
        <span>
          文档预览{" "}
          <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
            {path || name}
          </Typography.Text>
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(920px, 92vw)"
      style={{ top: 24 }}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        {error ? (
          <Typography.Paragraph type="danger">{error}</Typography.Paragraph>
        ) : content ? (
          <AgentOutputView output={content} maxHeight="min(70vh, 640px)" />
        ) : !loading ? (
          <Typography.Paragraph type="secondary">空文件</Typography.Paragraph>
        ) : null}
      </Spin>
    </Modal>
  );
}
