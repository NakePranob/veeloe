// The Markdown an Agent writes: headings, bullet and numbered lists, ``` blocks,
// and inside a line `code`, **bold** and [links](https://…).
// ponytail: no tables, quotes or nesting; add them when Agents send them.
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
  | { kind: "paragraph"; inline: Inline[] };

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
    for (const raw of part.split("\n")) {
      const line = raw.trim();
      const heading = line.match(/^#{1,3}\s+(.*)$/);
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
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
