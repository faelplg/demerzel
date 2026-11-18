import type { Env } from "../core/env.ts";
import { git } from "../core/git.ts";
import type { Failure } from "./validators.ts";

// Map paths follow check_project.py: relative, inside the repository, no
// parent traversal. The empty string denotes its root when allowed.
export function projectPath(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "" || value.startsWith("/") || /[\n\r\0\\]/.test(value)) return null;
  const parts = value.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) return null;
  return parts.join("/");
}

// The validated pin comes from the gate's PASS line. Never reread the
// caller's map after that gate, even when a concurrent edit replaces it.
export function readBaseMap(project: string, commit: string, pin: string, env: Env): { ok: true; map: Record<string, unknown> } | { ok: false; failure: Failure } {
  const shown = git(project, ["show", `${commit}:.radiant.json`], env);
  const invalid = (): { ok: false; failure: Failure } => ({ ok: false, failure: {
    code: "pin-mismatch", message: `.radiant.json at base commit ${commit} must be a JSON object with the validated radiant_revision ${pin}`,
    next: "Use a committed base with the validated Radiant pin.",
  } });
  if (shown.code !== 0) return invalid();
  let value: unknown;
  try { value = JSON.parse(shown.stdout); } catch { return invalid(); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  const map = value as Record<string, unknown>;
  if (map["radiant_revision"] !== pin) return invalid();
  return { ok: true, map };
}
