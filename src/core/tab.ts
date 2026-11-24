import type { Snapshot } from "./backend.ts";
import type { TaskRecord } from "./types.ts";

export function tabLabel(record: Pick<TaskRecord, "id" | "agent_name">): string {
  return `${record.id} ${record.agent_name}`;
}

export function findTab(record: Pick<TaskRecord, "backend_ids" | "project_workspace" | "id" | "agent_name">, snapshot: Snapshot): {
  tab: Snapshot["tabs"][number] | undefined;
  notOwned: { tab: string; agents: string[] } | null;
  byLabel: boolean;
} {
  if (record.backend_ids.tab !== null) return { tab: snapshot.tabs.find((t) => t.id === record.backend_ids.tab), notOwned: null, byLabel: false };
  const tab = record.project_workspace === undefined ? undefined : snapshot.tabs.find((t) => t.workspace === record.project_workspace!.id && t.label === tabLabel(record));
  const agents = tab === undefined ? [] : snapshot.agents.filter((a) => a.tab === tab.id).map((a) => a.name).sort();
  const notOwned = tab !== undefined && agents.some((name) => name !== record.agent_name) ? { tab: tab.id, agents } : null;
  return { tab: notOwned === null ? tab : undefined, notOwned, byLabel: tab !== undefined };
}
