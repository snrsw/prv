import { describe, expect, test } from "bun:test";
import { basename, splitPath } from "./paths";

describe("splitPath", () => {
  test("keeps the trailing slash on the directory part", () => {
    expect(splitPath("src/ui/components/DiffPanel.tsx")).toEqual({
      dir: "src/ui/components/",
      name: "DiffPanel.tsx",
    });
  });

  test("a root-level file has no directory part", () => {
    expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" });
  });

  test("a trailing slash names the directory itself", () => {
    expect(splitPath("src/ui/")).toEqual({ dir: "src/", name: "ui" });
    expect(splitPath("plans///")).toEqual({ dir: "", name: "plans" });
  });

  test("empty path", () => {
    expect(splitPath("")).toEqual({ dir: "", name: "" });
  });
});

describe("basename", () => {
  test("last segment, ignoring trailing slashes", () => {
    expect(basename("/home/me/prv")).toBe("prv");
    expect(basename("/home/me/prv/")).toBe("prv");
    expect(basename("a.ts")).toBe("a.ts");
    expect(basename("")).toBe("");
  });
});
