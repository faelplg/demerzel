import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Env } from "./env.ts";
import { git, gitOk } from "./git.ts";
import type { Pointer, Request, Task } from "./types.ts";

// Spec 2.1 and 2.2. Structural checks need nothing but the input; checks
// against the base commit need Git and run once the base is resolved.

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ROLE = /^[a-z][a-z0-9-]{0,63}$/;
const LABEL = /^[a-z][a-z0-9-]{0,31}$/;
const REF = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export type Check = { ok: true } | { ok: false; message: string };
const pass: Check = { ok: true };
const fail = (message: string): Check => ({ ok: false, message });

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Spec 2.1: relative to the project root, "/" separated, no leading "/", no
// empty, "." or ".." segment; a trailing "/" only marks a directory.
export function segments(path: string): string[] | null {
  if (path === "" || path.startsWith("/") || /[\n\r\0]/.test(path)) return null;
  const body = path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = body.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return parts;
}

// Two paths overlap when the segments of one are a prefix of the other's,
// equal included. Byte comparison, case-sensitive, no symlink resolution.
export function overlaps(a: string, b: string): boolean {
  const x = segments(a);
  const y = segments(b);
  if (x === null || y === null) return false;
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false;
  return true;
}

export function validateId(id: unknown): Check {
  return typeof id === "string" && ID.test(id) ? pass : fail(`ID fora do formato ${ID.source}`);
}

export function parseTask(input: unknown): { ok: true; task: Task } | { ok: false; message: string } {
  if (!isObject(input)) return { ok: false, message: "a tarefa precisa ser um objeto" };
  const t = input;
  const allowed = new Set(["id", "harness", "model", "effort", "branch", "base", "writes", "dependsOn", "request", "returnPath", "approval", "provenance"]);
  const extra = Object.keys(t).filter((key) => !allowed.has(key));
  if (extra.length > 0) return { ok: false, message: `campo desconhecido na tarefa: ${extra.join(", ")}` };

  const id = validateId(t["id"]);
  if (!id.ok) return id;
  for (const key of ["harness", "model", "branch", "returnPath"] as const) {
    const value = t[key];
    if (typeof value !== "string" || value === "" || /\s/.test(value)) {
      return { ok: false, message: `"${key}" precisa ser texto sem espaços` };
    }
  }
  for (const key of ["effort", "base"] as const) {
    const value = t[key];
    if (value !== undefined && (typeof value !== "string" || value === "" || /\s/.test(value))) {
      return { ok: false, message: `"${key}", quando presente, precisa ser texto sem espaços` };
    }
  }
  if (!isStringArray(t["writes"])) return { ok: false, message: `"writes" precisa ser uma lista de paths` };
  for (const path of t["writes"]) {
    if (segments(path) === null) return { ok: false, message: `path de "writes" fora da regra da Spec 2.1: ${JSON.stringify(path)}` };
  }
  if (!isStringArray(t["dependsOn"])) return { ok: false, message: `"dependsOn" precisa ser uma lista de IDs` };
  for (const dep of t["dependsOn"]) {
    if (!ID.test(dep)) return { ok: false, message: `dependência fora do formato de ID: ${JSON.stringify(dep)}` };
    if (dep === t["id"]) return { ok: false, message: "a tarefa não pode depender de si mesma" };
  }
  if (new Set(t["dependsOn"]).size !== t["dependsOn"].length) return { ok: false, message: "dependência repetida" };
  const returnPath = t["returnPath"] as string;
  if (segments(returnPath) === null || returnPath.endsWith("/")) {
    return { ok: false, message: `"returnPath" precisa ser um arquivo relativo ao worktree` };
  }
  if (t["approval"] !== undefined && t["approval"] !== "human") return { ok: false, message: `"approval" só aceita "human"` };
  const provenance = t["provenance"];
  if (!isObject(provenance) || !Object.values(provenance).every((value) => typeof value === "string")) {
    return { ok: false, message: `"provenance" precisa ser um objeto de textos` };
  }
  const request = parseRequest(t["request"]);
  if (!request.ok) return request;

  const task: Task = {
    id: t["id"] as string,
    harness: t["harness"] as string,
    model: t["model"] as string,
    branch: t["branch"] as string,
    writes: [...t["writes"]],
    dependsOn: [...t["dependsOn"]],
    request: request.request,
    returnPath,
    provenance: { ...(provenance as Record<string, string>) },
  };
  if (typeof t["effort"] === "string") task.effort = t["effort"];
  if (typeof t["base"] === "string") task.base = t["base"];
  if (t["approval"] === "human") task.approval = "human";
  return { ok: true, task };
}

function parseRequest(input: unknown): { ok: true; request: Request } | { ok: false; message: string } {
  if (!isObject(input)) return { ok: false, message: `"request" precisa ser um objeto` };
  const role = input["role"];
  if (typeof role !== "string" || !ROLE.test(role)) return { ok: false, message: `papel fora do formato ${ROLE.source}` };
  const raw = input["pointers"];
  if (!Array.isArray(raw)) return { ok: false, message: `"pointers" precisa ser uma lista` };
  const pointers: Pointer[] = [];
  const labels = new Set<string>();
  for (const item of raw) {
    if (!isObject(item)) return { ok: false, message: "pointer precisa ser um objeto" };
    const label = item["label"];
    if (typeof label !== "string" || !LABEL.test(label)) return { ok: false, message: `label fora do formato ${LABEL.source}` };
    if (labels.has(label)) return { ok: false, message: `label repetido: ${label}` };
    labels.add(label);
    const keys = Object.keys(item).sort().join(",");
    if (keys === "label,path" && typeof item["path"] === "string") {
      const path = item["path"];
      if (path === "" || /[\n\r\0]/.test(path)) return { ok: false, message: `path de pointer inválido em ${label}` };
      pointers.push({ label, path });
    } else if (keys === "label,ref" && typeof item["ref"] === "string") {
      if (!REF.test(item["ref"])) return { ok: false, message: `ref de pointer fora do formato de commit completo em ${label}` };
      pointers.push({ label, ref: item["ref"] });
    } else {
      return { ok: false, message: `pointer ${label} precisa ter exatamente "path" ou "ref"` };
    }
  }
  return { ok: true, request: { role, pointers } };
}

// Pointer paths: absolute and existing, or relative and present in the base
// commit (Spec 2.2).
export function checkPointers(task: Task, mainCheckout: string, baseCommit: string, env: Env): Check {
  for (const pointer of task.request.pointers) {
    if (!("path" in pointer)) continue;
    if (isAbsolute(pointer.path)) {
      if (!existsSync(pointer.path)) return fail(`pointer ${pointer.label}: ${pointer.path} não existe`);
    } else if (!gitOk(mainCheckout, ["cat-file", "-e", `${baseCommit}:${pointer.path}`], env)) {
      return fail(`pointer ${pointer.label}: ${pointer.path} não está no commit base ${baseCommit}`);
    }
  }
  return pass;
}

export function checkBranchName(branch: string, mainCheckout: string, env: Env): Check {
  return gitOk(mainCheckout, ["check-ref-format", "--branch", branch], env) ? pass : fail(`branch inválido para o Git: ${branch}`);
}

// Spec 3.3, the core's part: an explicit ref, or the caller's current branch,
// or the HEAD commit when detached.
export function resolveBase(task: Task, callerRoot: string, env: Env): { ok: true; ref: string; commit: string } | { ok: false; message: string } {
  if (task.base !== undefined) {
    const commit = git(callerRoot, ["rev-parse", "--verify", "--quiet", `${task.base}^{commit}`], env);
    if (commit.code !== 0) return { ok: false, message: `base não resolve para um commit: ${task.base}` };
    return { ok: true, ref: task.base, commit: commit.stdout };
  }
  const head = git(callerRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], env);
  if (head.code !== 0) return { ok: false, message: "o checkout chamador não tem commit em HEAD" };
  const branch = git(callerRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], env);
  return { ok: true, ref: branch.code === 0 ? branch.stdout : head.stdout, commit: head.stdout };
}

// Spec 2.2: the fixed Demerzel text with the task ID, the role, the pointers
// and the return path. Nothing else enters the request.
export function buildRequest(task: Task): string {
  const lines = [
    `Demerzel: tarefa ${task.id}.`,
    `Papel: ${task.request.role}.`,
    "Leia os pointers abaixo e execute a tarefa no papel indicado.",
    `Grave o retorno em ${task.returnPath}, relativo à raiz deste worktree.`,
    "Pointers:",
    ...task.request.pointers.map((p) => `- ${p.label}: ${"path" in p ? p.path : p.ref}`),
  ];
  return `${lines.join("\n")}\n`;
}
