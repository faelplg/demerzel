import { dlopen, FFIType } from "bun:ffi";
import { closeSync, constants, ftruncateSync, openSync, writeSync } from "node:fs";

// Spec 2.3: the project lock is flock(LOCK_EX) on the `lock` file, asked
// without blocking and retried. The kernel releases it when the process
// ends, so there is no stale lock to take over. The pid and time written into
// the file are for diagnosis only.

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

type Libc = { flock: (fd: number, op: number) => number };
let libc: Libc | null = null;

function flock(): Libc["flock"] {
  if (libc === null) {
    const name = process.platform === "darwin" ? "libc.dylib" : "libc.so.6";
    const lib = dlopen(name, { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
    libc = { flock: (fd, op) => lib.symbols.flock(fd, op) };
  }
  return libc.flock;
}

export type LockClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type LockOptions = LockClock & {
  timeoutMs: number;
  intervalMs: number;
  trace?: (event: string) => void;
};

export class ProjectLock {
  private constructor(private fd: number | null) {}

  // One attempt, no waiting. Null when another open file holds the lock.
  static tryAcquire(path: string): ProjectLock | null {
    const fd = openSync(path, constants.O_RDWR | constants.O_CREAT, 0o600);
    if (flock()(fd, LOCK_EX | LOCK_NB) !== 0) {
      closeSync(fd);
      return null;
    }
    const lock = new ProjectLock(fd);
    lock.stamp();
    return lock;
  }

  // Retries until the lock is free or the timeout passes. Null on timeout.
  static async acquire(path: string, options: LockOptions): Promise<ProjectLock | null> {
    const deadline = options.now() + options.timeoutMs;
    let waited = false;
    for (;;) {
      const lock = ProjectLock.tryAcquire(path);
      if (lock !== null) {
        options.trace?.("lock-acquired");
        return lock;
      }
      if (!waited) {
        waited = true;
        options.trace?.("lock-waiting");
      }
      if (options.now() >= deadline) return null;
      await options.sleep(options.intervalMs);
    }
  }

  release(): void {
    if (this.fd === null) return;
    flock()(this.fd, LOCK_UN);
    closeSync(this.fd);
    this.fd = null;
  }

  private stamp(): void {
    if (this.fd === null) return;
    ftruncateSync(this.fd, 0);
    writeSync(this.fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`, 0);
  }
}
