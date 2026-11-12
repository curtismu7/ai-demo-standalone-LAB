// P7 hardening: the 375px pass as a test. jsdom has no layout engine, so this asserts the
// CSS contract instead of pixels: no stylesheet may set a fixed min-width or width greater
// than 375px on a layout container (the widths that cause horizontal scroll on a phone),
// and the small-screen rules that stack the shell bar, the run-log table and the composer
// must exist. The real 375px overflow numbers come from scripts/e2e.mjs (real Chromium).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const files = ["src/app.css", "src/shell.css", "src/pages/app.css"];

const cssOf = (f) => fs.readFileSync(path.join(root, f), "utf8");

describe("375px CSS contract (P7)", () => {
  it("no app stylesheet fixes a width or min-width above 375px on a selector", () => {
    for (const f of files) {
      const css = cssOf(f);
      for (const m of css.matchAll(/(?:^|[{;\s])(min-)?width:\s*(\d+)px/g)) {
        expect(Number(m[2]), `${f}: ${(m[1] || "")}width: ${m[2]}px exceeds 375px`).toBeLessThanOrEqual(375);
      }
    }
  });
  it("the shell bar wraps and the nav drops to its own row on small screens", () => {
    const shell = cssOf("src/shell.css");
    expect(shell).toContain(".shell-bar { display: flex");
    expect(shell).toContain("flex-wrap: wrap");
    expect(shell).toMatch(/@media \(max-width: 600px\) \{[^@]*\.shell-nav \{ order: 3; flex-basis: 100%/);
  });
  it("the run-log table, the stepper tiles and the composer input stack at 480px", () => {
    const app = cssOf("src/app.css");
    expect(app).toMatch(/@media \(max-width: 480px\)[^}]*\.obs-table \{ display: block; overflow-x: auto/s);
    expect(app).toMatch(/\.stepper \.step \{ min-width: 0; flex: 1 1 100%/s);
    expect(app).toMatch(/\.composer input \{ min-width: 0; flex: 1 1 100%/s);
  });
  it("the launcher rows wrap with min-width 0 (no fixed row width)", () => {
    const app = cssOf("src/app.css");
    for (const cls of [".uc-rows li", ".uc-title"]) {
      expect(app).toContain(cls);
    }
    expect(app).toMatch(/\.uc-rows li \{[^}]*flex-wrap: wrap[^}]*min-width: 0/s);
  });
});
