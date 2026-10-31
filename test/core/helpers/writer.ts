// Rewrites one task file in a loop through Registry.write until <stop> exists.
// The record is large so a non-atomic write would be visible half done.
import { existsSync, writeFileSync } from "node:fs";
import { Registry } from "../../../src/core/registry.ts";
import type { TaskRecord } from "../../../src/core/types.ts";

const [dir, stop, ready] = process.argv.slice(2) as [string, string, string];
const registry = new Registry(dir);
registry.ensure();
const big = "x".repeat(200_000);
let n = 0;
writeFileSync(ready, "");
while (!existsSync(stop)) {
  n++;
  const record = { schema: 1, id: "TC-0099.1", lifecycle: "launched", padding: `${n}:${big}` } as unknown as TaskRecord;
  registry.write(record);
}
