// Verification 1 runs with no python3 on PATH. This builds a PATH with only
// git and bun, proves python3 is not reachable from it, and runs the core
// suite there.
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "dz-path-"));
try {
  for (const tool of ["git", "bun"]) {
    const found = Bun.which(tool);
    if (found === null) throw new Error(`${tool} not found on PATH`);
    symlinkSync(found, join(dir, tool));
  }
  for (const python of ["python3", "python"]) {
    if (Bun.which(python, { PATH: dir }) !== null) throw new Error(`${python} is reachable from the isolated PATH`);
  }
  console.log(`PATH=${dir} (git, bun; no python3)`);
  const proc = Bun.spawn([join(dir, "bun"), "test", "./test/core"], { env: { ...process.env, PATH: dir }, stdout: "inherit", stderr: "inherit" });
  process.exitCode = await proc.exited;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
