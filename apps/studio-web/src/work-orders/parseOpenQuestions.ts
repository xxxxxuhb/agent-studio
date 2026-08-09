/**
 * Parse Open Questions / 待澄清 tables from agent Markdown.
 * Supports 3-col (#/问题/默认) and 4-col (#/问题/影响/默认) Chinese or English headers.
 */

export type OpenQuestion = {
  id: string;
  question: string;
  defaultAnswer: string;
  impact?: string;
};

export type OpenQuestionAnswer = {
  id: string;
  question: string;
  answer: string;
  usedDefault: boolean;
};

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, "")));
}

function stripMd(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreHeader(cells: string[]): {
  id: number;
  question: number;
  defaultCol: number;
  impact: number;
} | null {
  const lower = cells.map((c) => c.toLowerCase());
  const id = lower.findIndex((c) => /^(#|id|oq)$/i.test(c) || c === "编号");
  const question = lower.findIndex(
    (c) =>
      /question|问题/.test(c) ||
      c === "问" ||
      /待澄清/.test(c),
  );
  const defaultCol = lower.findIndex(
    (c) =>
      /default|默认|建议默认|无回复/.test(c) ||
      /if unanswered/.test(c),
  );
  const impact = lower.findIndex((c) => /影响|impact/.test(c));
  if (question < 0 || defaultCol < 0) return null;
  return {
    id: id >= 0 ? id : 0,
    question,
    defaultCol,
    impact,
  };
}

function inferBinaryOptions(question: string, defaultAnswer: string): string[] | undefined {
  const q = question;
  const d = defaultAnswer;
  if (!/是否|要不要|需不需要|\bor\b|还是/.test(q) && !/是否|要不要/.test(d)) {
    return undefined;
  }
  // Common: 否 — xxx / 是 — xxx
  const m = /^(是|否)\s*[—\-–]\s*(.+)$/.exec(d);
  if (m) {
    const other = m[1] === "是" ? "否" : "是";
    return [d, `${other}（不采用默认）`];
  }
  if (/^是\b/.test(d) || /建议实现|保留|提供/.test(d)) {
    return [d, "否 / 不采用"];
  }
  if (/^否\b/.test(d) || /本期不做|不强制/.test(d)) {
    return [d, "是 / 改为采用"];
  }
  return undefined;
}

export function parseOpenQuestions(raw: string | null | undefined): OpenQuestion[] {
  if (!raw?.trim()) return [];
  const text = raw.replace(/\r\n/g, "\n");

  // Prefer a dedicated Open Questions section when present
  const section =
    /(?:^|\n)##?\s*[^\n]*(?:开放问题|Open Questions|待澄清问题|待澄清)[^\n]*\n([\s\S]*?)(?=\n##\s+|\n---\s*\n|$)/i.exec(
      text,
    );
  const slice = section?.[1] || text;

  const lines = slice.split("\n");
  const found: OpenQuestion[] = [];
  let mapping: ReturnType<typeof scoreHeader> | null = null;

  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length < 2) continue;
    if (isSeparatorRow(cells)) continue;

    const header = scoreHeader(cells);
    if (header) {
      mapping = header;
      continue;
    }
    if (!mapping) {
      // Heuristic: OQ-n in first cell
      if (/^OQ[-_]?\d+/i.test(cells[0] || "")) {
        mapping = {
          id: 0,
          question: 1,
          defaultCol: cells.length >= 4 ? 3 : Math.min(2, cells.length - 1),
          impact: cells.length >= 4 ? 2 : -1,
        };
      } else {
        continue;
      }
    }

    const idRaw = cells[mapping.id] || "";
    const idMatch = /^(OQ[-_]?\d+|\d+)/i.exec(idRaw);
    if (!idMatch && !/^OQ/i.test(idRaw)) continue;
    const id = idMatch ? idMatch[1]!.toUpperCase().replace(/_/g, "-") : idRaw;
    const question = stripMd(cells[mapping.question] || "");
    const defaultAnswer = stripMd(cells[mapping.defaultCol] || "");
    if (!question || !defaultAnswer) continue;
    const impact =
      mapping.impact >= 0 ? stripMd(cells[mapping.impact] || "") : undefined;
    found.push({
      id: id.startsWith("OQ") ? id : `OQ-${id}`,
      question,
      defaultAnswer,
      impact: impact || undefined,
    });
  }

  // Dedupe by id, keep first
  const seen = new Set<string>();
  return found.filter((q) => {
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });
}

export function suggestOptions(q: OpenQuestion): string[] | undefined {
  return inferBinaryOptions(q.question, q.defaultAnswer);
}

export function formatOpenQuestionFeedback(
  answers: OpenQuestionAnswer[],
  title = "澄清确认",
): string {
  if (!answers.length) return title;
  const lines = [
    title,
    "",
    ...answers.map(
      (a) =>
        `- ${a.id}: ${a.answer}${a.usedDefault ? " 〔默认〕" : " 〔自定义〕"}\n  （${a.question}）`,
    ),
  ];
  return lines.join("\n");
}

export function answersFromDefaults(questions: OpenQuestion[]): OpenQuestionAnswer[] {
  return questions.map((q) => ({
    id: q.id,
    question: q.question,
    answer: q.defaultAnswer,
    usedDefault: true,
  }));
}
