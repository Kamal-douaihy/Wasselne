import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

describe("design token generation", () => {
  beforeAll(() => {
    execFileSync(join(packageDir, "node_modules/.bin/tsx"), [join(packageDir, "src/generate.ts")], {
      cwd: packageDir,
    });
  });

  it("resolves every {ns.key} reference in the generated CSS", () => {
    const css = readFileSync(join(packageDir, "dist/tokens.css"), "utf8");
    expect(css).not.toMatch(/\{[\w-]+\.[\w-]+\}/);
    expect(css).toMatch(/--wsl-color-brand-cedar-500: #0B6E4F;/);
    expect(css).toMatch(/--wsl-light-primary: #0B6E4F;/);
    expect(css).toMatch(/--wsl-dark-primary: #5FB08F;/);
  });

  it("emits valid opaque Dart Color literals, not truncated 6-digit ints", () => {
    const dart = readFileSync(join(packageDir, "../flutter_core/lib/theme/tokens.g.dart"), "utf8");
    expect(dart).toMatch(/static const Color primary = Color\(0xFF0B6E4F\);/);
    expect(dart).not.toMatch(/Color\(0x[0-9A-Fa-f]{6}\)/); // would silently be transparent
  });
});
