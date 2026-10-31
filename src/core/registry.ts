import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
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

  // The rename only happens after every byte reached the temporary file. A
  // short write (a full disk, a file size limit) leaves the final file as it
  // was and throws.
  write(record: TaskRecord): void {
    const tmp = join(this.tasksDir, `.${record.id}.${randomBytes(6).toString("hex")}.tmp`);
    const data = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    const fd = openSync(tmp, "wx", 0o600);
    try {
      let offset = 0;
      while (offset < data.length) {
        const written = writeSync(fd, data, offset, data.length - offset);
        if (written <= 0) throw new Error(`gravação incompleta de ${tmp}`);
        offset += written;
      }
      fsyncSync(fd);
    } catch (error) {
      closeSync(fd);
      rmSync(tmp, { force: true });
      throw error;
    }
    closeSync(fd);
    renameSync(tmp, this.file(record.id));
  }
}

export function entry(event: string, detail: Record<string, unknown> | null = null): HistoryEntry {
  return { at: new Date().toISOString(), event, detail };
}
