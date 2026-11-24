import { basename } from "node:path";
import type { Snapshot, WorkspaceLookup } from "./backend.ts";

// Pure lookup shared by backend implementations. Configuration stays in the adapter.
export function resolveWorkspace(mainCheckout: string, snapshot: Snapshot, override?: string): WorkspaceLookup {
  const label = override ?? basename(mainCheckout);
  const source = override === undefined ? "directory" : "config";
  const matches = snapshot.workspaces.filter((w) => w.label === label);
  if (matches.length === 0) return {
    ok: false, code: "project-workspace-missing",
    message: `No project workspace labeled ${JSON.stringify(label)} for ${mainCheckout} (source: ${source === "config" ? `herdr.workspace_labels for ${mainCheckout}` : "main checkout directory name"}).`,
    next: `Create a herdr workspace with that label in the configured session, or map ${mainCheckout} in herdr.workspace_labels.`,
  };
  if (matches.length > 1) return {
    ok: false, code: "project-workspace-ambiguous",
    message: `Project workspace label ${JSON.stringify(label)} for ${mainCheckout} matches: ${matches.map((w) => w.id).join(", ")}.`,
    next: "Rename or close the extra workspaces, or map the path to a unique label in herdr.workspace_labels.",
  };
  return { ok: true, workspace: { id: matches[0]!.id, label, source } };
}
