// The Markdown an Agent writes: headings, bullet and numbered lists, ``` blocks,
// `>` quotes, tables, and inside a line `code`, **bold** and [links](https://…).
// Ported from controller-prototype.
// ponytail: no nesting; add it when Agents nest lists.
export interface Inline {
  text: string;
  code?: boolean;
  bold?: boolean;
  link?: string;
}

export type Block =
  | { kind: "code"; text: string }
  | { kind: "heading"; inline: Inline[] }
  | { kind: "item"; marker: string; inline: Inline[] }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "quote"; inline: Inline[] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] };

/** One table row as cells, split on the pipes a table uses. */
const cells = (line: string) =>
  line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

/** The line under a table's header: `| --- | :-: |` and nothing else. */
const isTableRule = (line: string) => line.includes("|") && /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(line);

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/;

export function parseInline(line: string): Inline[] {
  return line
    .split(INLINE)
    .filter(Boolean)
    .map((piece) => {
      if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2) return { text: piece.slice(1, -1), code: true };
      if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) return { text: piece.slice(2, -2), bold: true };
      const link = piece.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      // Only web links open; anything else an Agent writes stays plain text.
      if (link && /^https?:\/\//.test(link[2])) return { text: link[1], link: link[2] };
      return { text: piece };
    });
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  text.split("```").forEach((part, i) => {
    if (i % 2) {
      blocks.push({ kind: "code", text: part.replace(/^\w*\n/, "").replace(/\n$/, "") });
      return;
    }
    let paragraph: string[] = [];
    const flush = () => {
      if (paragraph.length) blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join("\n")) });
      paragraph = [];
    };
    const lines = part.split("\n").map((line) => line.trim());
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const heading = line.match(/^#{1,3}\s+(.*)$/);
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
      const quoted = line.match(/^>\s?(.*)$/);
      // A table is a header row with pipes, then the rule line under it.
      const tabular = line.includes("|") && isTableRule(lines[index + 1] ?? "");
      if (tabular) {
        flush();
        const header = cells(line).map(parseInline);
        const rows: Inline[][][] = [];
        for (index += 2; index < lines.length && lines[index]!.includes("|"); index++) rows.push(cells(lines[index]!).map(parseInline));
        index--;
        blocks.push({ kind: "table", header, rows });
        continue;
      }
      if (quoted) {
        flush();
        const quotedLines = [quoted[1]!];
        while (/^>\s?/.test(lines[index + 1] ?? "")) quotedLines.push(lines[++index]!.replace(/^>\s?/, ""));
        blocks.push({ kind: "quote", inline: parseInline(quotedLines.join("\n")) });
        continue;
      }
      if (line && !heading && !bullet && !numbered) {
        paragraph.push(line);
        continue;
      }
      flush();
      if (heading) blocks.push({ kind: "heading", inline: parseInline(heading[1]) });
      if (bullet) blocks.push({ kind: "item", marker: "•", inline: parseInline(bullet[1]) });
      if (numbered) blocks.push({ kind: "item", marker: `${numbered[1]}.`, inline: parseInline(numbered[2]) });
    }
    flush();
  });
  return blocks;
}

// The first line of an Agent's text as plain words, for the inbox preview.
export function plainFirstLine(text: string) {
  const block = parseMarkdown(text).find((candidate) => candidate.kind !== "code");
  if (!block || !("inline" in block)) return "";
  return block.inline.map((piece) => piece.text).join("").split("\n")[0];
}
