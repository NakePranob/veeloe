import { expect, test } from "bun:test";
import { parseMarkdown, plainFirstLine } from "./markdown";

test("blocks, lists and code an Agent writes, and only web links open", () => {
  expect(parseMarkdown("# Plan\n- **one** `two`\n1. [site](https://a.test) [x](javascript:alert(1))\n```sh\nls\n```")).toEqual([
    { kind: "heading", inline: [{ text: "Plan" }] },
    { kind: "item", marker: "•", inline: [{ text: "one", bold: true }, { text: " " }, { text: "two", code: true }] },
    { kind: "item", marker: "1.", inline: [{ text: "site", link: "https://a.test" }, { text: " " }, { text: "[x](javascript:alert(1)" }, { text: ")" }] },
    { kind: "code", text: "ls" },
  ]);
  expect(plainFirstLine("```\ncode\n```\n**Done** now\nmore")).toBe("Done now");
});

test("a quote keeps its lines together, and a table keeps its header and rows", () => {
  const blocks = parseMarkdown("> first\n> second\n\n| Name | Value |\n| --- | --- |\n| a | 1 |\n| b | 2 |");
  expect(blocks).toEqual([
    { kind: "quote", inline: [{ text: "first\nsecond" }] },
    {
      kind: "table",
      header: [[{ text: "Name" }], [{ text: "Value" }]],
      rows: [[[{ text: "a" }], [{ text: "1" }]], [[{ text: "b" }], [{ text: "2" }]]],
    },
  ]);
});

test("a line with a pipe but no rule under it stays a paragraph", () => {
  expect(parseMarkdown("use a | b for or")).toEqual([{ kind: "paragraph", inline: [{ text: "use a | b for or" }] }]);
});

test("a header-looking line under a bare dash rule is not a table", () => {
  expect(parseMarkdown("a | b\n---")).toEqual([{ kind: "paragraph", inline: [{ text: "a | b\n---" }] }]);
});
