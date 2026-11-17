import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { validateId } from "./task.ts";
import type { HistoryEntry, TaskRecord } from "./types.ts";

// Spec 2.3: one file per task in tasks/<id>.json, written to a temporary file
// and renamed, so a reader never sees half a file.
export class Registry {
  readonly tasksDir: string;
  readonly worktreesDir: string;
  readonly lockPath: string;
  readonly locksDir: string;
  readonly logsDir: string;

  constructor(readonly dir: string) {
    this.tasksDir = join(dir, "tasks");
    this.worktreesDir = join(dir, "worktrees");
    this.lockPath = join(dir, "lock");
    this.locksDir = join(dir, "locks");
    this.logsDir = join(dir, "logs");
  }

  ensure(): void {
    mkdirSync(this.tasksDir, { recursive: true });
    mkdirSync(this.worktreesDir, { recursive: true });
    mkdirSync(this.locksDir, { recursive: true });
  }

  // Spec 2.3, revision 0.15: the task lock. Only callers that validated the
  // ID reach a path.
  taskLockPath(id: string): string {
    if (!validateId(id).ok) throw new Error(`invalid task ID for a lock path: ${id}`);
    return join(this.locksDir, `${id}.lock`);
  }

  prepareLogPath(id: string): string {
    if (!validateId(id).ok) throw new Error(`invalid task ID for a log path: ${id}`);
    return join(this.logsDir, id, "prepare.log");
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
    return validateId(id).ok && existsSync(this.file(id));
  }

  // An ID outside the format of Spec 2.1 never becomes a path, so `..` can
  // not reach a file outside tasks/.
  read(id: string): TaskRecord | null {
    if (!validateId(id).ok) return null;
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
