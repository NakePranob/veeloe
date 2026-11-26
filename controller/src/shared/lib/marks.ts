// A translated line with a styled part inside it (a link, a mono name, a bold word) keeps that part where each
// language puts it (ADR 0065): the line is translated with stand-ins, then cut around them.

/** The stand-in for the n-th styled part, a private-use character no translation contains. */
export const mark = (n: number) => String.fromCharCode(0xe000 + n);

/** The line cut around its stand-ins: text as strings, each stand-in as its number, in the language's own order. */
export const splitMarks = (line: string): (string | number)[] =>
  line
    .split(/([-])/)
    .filter(Boolean)
    .map((piece) => (/^[-]$/.test(piece) ? piece.charCodeAt(0) - 0xe000 : piece));
