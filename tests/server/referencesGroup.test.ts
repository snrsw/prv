import { test, expect } from "bun:test";
import { groupReferences, type RawReference } from "../../src/lsp/referencesGroup";

const ROOT = "/repo";
const CURRENT = "src/a.ts";

function ref(uri: string, line: number, character: number): RawReference {
  return { uri, line, character };
}

test("groupReferences with no inputs returns three empty groups", () => {
  expect(groupReferences([], ROOT, CURRENT)).toEqual({
    inFile: [],
    local: [],
    external: 0,
  });
});

test("a reference whose URI is the current file goes to inFile", () => {
  const r = ref("file:///repo/src/a.ts", 4, 2);
  const out = groupReferences([r], ROOT, CURRENT);
  expect(out.inFile).toEqual([{ line: 4, character: 2 }]);
  expect(out.local).toEqual([]);
  expect(out.external).toBe(0);
});

test("a reference inside rootDir but in another file is grouped under local", () => {
  const r = ref("file:///repo/src/b.ts", 7, 0);
  const out = groupReferences([r], ROOT, CURRENT);
  expect(out.inFile).toEqual([]);
  expect(out.local).toEqual([{ path: "src/b.ts", refs: [{ line: 7, character: 0 }] }]);
  expect(out.external).toBe(0);
});

test("references outside rootDir are counted in external", () => {
  const out = groupReferences(
    [ref("file:///elsewhere/dist/lib.d.ts", 1, 0), ref("file:///elsewhere/dep.ts", 2, 0)],
    ROOT,
    CURRENT,
  );
  expect(out.inFile).toEqual([]);
  expect(out.local).toEqual([]);
  expect(out.external).toBe(2);
});

test("multiple references in the same local file are coalesced into one group", () => {
  const out = groupReferences(
    [ref("file:///repo/src/b.ts", 1, 0), ref("file:///repo/src/b.ts", 9, 4)],
    ROOT,
    CURRENT,
  );
  expect(out.local).toEqual([
    {
      path: "src/b.ts",
      refs: [
        { line: 1, character: 0 },
        { line: 9, character: 4 },
      ],
    },
  ]);
});
