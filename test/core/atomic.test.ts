import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sandbox, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

describe("atomic task files (R4)", () => {
  // Protects: a reader never sees half a task file while another process
  // rewrites it. Fails if Registry.write stops using a temporary file and
  // rename.
  test("a concurrent reader always parses a whole file", async () => {
    const dir = join(sb.root, "registry");
    const stop = join(sb.root, "stop");
    const ready = join(sb.root, "ready");
    const writer = Bun.spawn([process.execPath, join(import.meta.dir, "helpers", "writer.ts"), dir, stop, ready], { stdout: "ignore", stderr: "pipe" });
    const file = join(dir, "tasks", "TC-0099.1.json");
    const deadline = Date.now() + 10_000;
    while (!existsSync(ready) || !existsSync(file)) {
      if (Date.now() > deadline) throw new Error("writer did not start");
      await Bun.sleep(5);
    }
    let reads = 0;
    let broken = 0;
    const until = Date.now() + 1_500;
    while (Date.now() < until) {
      try {
        const record = JSON.parse(readFileSync(file, "utf8"));
        if (record.id !== "TC-0099.1") broken++;
      } catch {
        broken++;
      }
      reads++;
    }
    writeFileSync(stop, "");
    await writer.exited;
    expect(reads).toBeGreaterThan(50);
    expect(broken).toBe(0);
  });
});
