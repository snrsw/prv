import { test, expect, describe } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

async function readJson(path: string): Promise<Record<string, unknown>> {
  return (await Bun.file(join(root, path)).json()) as Record<string, unknown>;
}

describe("Claude Code plugin manifests", () => {
  test("plugin.json parses and names the plugin 'prv'", async () => {
    const plugin = await readJson(".claude-plugin/plugin.json");
    expect(plugin.name).toBe("prv");
    expect(typeof plugin.description).toBe("string");
    expect((plugin.description as string).length).toBeGreaterThan(0);
  });

  test("marketplace.json lists the prv plugin with a resolvable source", async () => {
    const marketplace = await readJson(".claude-plugin/marketplace.json");
    expect(marketplace.name).toBe("prv");
    const plugins = marketplace.plugins as Array<Record<string, unknown>>;
    expect(Array.isArray(plugins)).toBe(true);
    const entry = plugins.find((p) => p.name === "prv");
    expect(entry).toBeDefined();
    // "./" points the plugin at the repo root, where commands/ and skills/ live.
    expect(entry!.source).toBe("./");
  });

  test("/prv command exists with frontmatter description", async () => {
    const text = await Bun.file(join(root, "commands/prv.md")).text();
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("description:");
    expect(text).toContain("prv diff");
  });

  test("prv-review skill exists and teaches the headless workflow", async () => {
    const text = await Bun.file(join(root, "skills/prv-review/SKILL.md")).text();
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("name: prv-review");
    expect(text).toContain("description:");
    expect(text).toContain("prv comments list --unresolved --json");
    expect(text).toContain("prv reply");
    expect(text).toContain("prv resolve");
  });
});
