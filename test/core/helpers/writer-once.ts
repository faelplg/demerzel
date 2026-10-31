// Writes a small task record, then a large one. Run under `ulimit -f`, the
// large write is cut by the file size limit in the middle, as a crash would.
import { Registry } from "../../../src/core/registry.ts";
import type { TaskRecord } from "../../../src/core/types.ts";

const [dir] = process.argv.slice(2) as [string];
const registry = new Registry(dir);
registry.ensure();
registry.write({ schema: 1, id: "TC-0099.1", lifecycle: "launched", marker: "first" } as unknown as TaskRecord);
registry.write({ schema: 1, id: "TC-0099.1", lifecycle: "launched", marker: "second", padding: "x".repeat(400_000) } as unknown as TaskRecord);
