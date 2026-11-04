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
