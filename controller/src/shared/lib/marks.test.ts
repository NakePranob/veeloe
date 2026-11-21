import { expect, test } from "bun:test";
import { mark, splitMarks } from "./marks";

test("a line is cut around its stand-ins in the order the language wrote them", () => {
  expect(splitMarks(`${mark(0)} by Nok · ${mark(1)}`)).toEqual([0, " by Nok · ", 1]);
  expect(splitMarks(`เพิ่ม ${mark(1)} เข้า Egress`)).toEqual(["เพิ่ม ", 1, " เข้า Egress"]);
  expect(splitMarks("plain")).toEqual(["plain"]);
});
