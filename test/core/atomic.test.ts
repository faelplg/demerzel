import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

  // Protects: a write cut in the middle, as by a crash or a full disk,
  // leaves the previous file whole. The file size limit makes the cut
  // deterministic, which a race between processes is not on APFS. Fails if
  // Registry.write writes in place, or renames a short temporary file.
  test("a write cut by the file size limit keeps the previous record", async () => {
    const dir = join(sb.root, "registry");
    const writer = Bun.spawn(["/bin/sh", "-c", 'ulimit -f 128; exec "$@"', "sh", process.execPath, join(import.meta.dir, "helpers", "writer-once.ts"), dir], {
      stdout: "ignore",
      stderr: "pipe",
      env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    });
    const code = await writer.exited;
    const stderr = await new Response(writer.stderr).text();
    expect(code).not.toBe(0);
    expect(stderr).toContain("EFBIG");
    const tasks = join(dir, "tasks");
    expect(readdirSync(tasks)).toEqual(["TC-0099.1.json"]);
    expect(JSON.parse(readFileSync(join(tasks, "TC-0099.1.json"), "utf8")).marker).toBe("first");
  });
});
