import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { HistoryEntry, TaskRecord } from "./types.ts";

// Spec 2.3: one file per task in tasks/<id>.json, written to a temporary file
// and renamed, so a reader never sees half a file.
export class Registry {
  readonly tasksDir: string;
  readonly worktreesDir: string;
  readonly lockPath: string;

  constructor(readonly dir: string) {
    this.tasksDir = join(dir, "tasks");
    this.worktreesDir = join(dir, "worktrees");
    this.lockPath = join(dir, "lock");
  }

  ensure(): void {
    mkdirSync(this.tasksDir, { recursive: true });
    mkdirSync(this.worktreesDir, { recursive: true });
  }

  worktreePath(id: string): string {
    return join(this.worktreesDir, id);
  }

  private file(id: string): string {
    return join(this.tasksDir, `${id}.json`);
  }

  // True when a file answers for this ID. On a case-insensitive file system
  // an ID that only differs in case answers too, and counts as taken.
  taken(id: string): boolean {
    return existsSync(this.file(id));
  }

  read(id: string): TaskRecord | null {
    const path = this.file(id);
    if (!existsSync(path)) return null;
    const record = JSON.parse(readFileSync(path, "utf8")) as TaskRecord;
    return record.id === id ? record : null;
  }

  list(): TaskRecord[] {
    if (!existsSync(this.tasksDir)) return [];
    return readdirSync(this.tasksDir)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .map((name) => JSON.parse(readFileSync(join(this.tasksDir, name), "utf8")) as TaskRecord)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  write(record: TaskRecord): void {
    const tmp = join(this.tasksDir, `.${record.id}.${randomBytes(6).toString("hex")}.tmp`);
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.file(record.id));
  }
}

export function entry(event: string, detail: Record<string, unknown> | null = null): HistoryEntry {
  return { at: new Date().toISOString(), event, detail };
}
