import { expect, test } from "bun:test";
import { toRepo } from "./repo";

test("a pasted GitHub URL or ssh remote reads as owner/name", () => {
  expect(toRepo("acme/shop")).toBe("acme/shop");
  expect(toRepo("  Acme/Shop ")).toBe("acme/shop");
  expect(toRepo("https://github.com/acme/shop")).toBe("acme/shop");
  expect(toRepo("https://github.com/acme/shop.git/")).toBe("acme/shop");
  expect(toRepo("git@github.com:acme/shop.git")).toBe("acme/shop");
});

test("anything that is not one GitHub repo is refused", () => {
  for (const input of ["", "shop", "acme/shop/tree/main", "https://gitlab.com/acme/shop", "../shop", "acme/..", "acme shop/x"]) {
    expect(toRepo(input)).toBeNull();
  }
});
