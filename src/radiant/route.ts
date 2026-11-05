import type { Candidate } from "./validators.ts";

// Spec 3, item 6, as a pure function over rules, adapters and roles already
// read. The orchestrator chose the rule; this only walks its candidates.

export type Adapter = { models: Record<string, string>; provides: string[] };

export type RouteInput = {
  candidates: Candidate[];
  unit: { capability: string | null; requires: string[] };
  // The role's default capability in agents.json, or null.
  roleDefault: string | null;
  // agents.json "capabilities", from the highest to the lowest.
  order: string[];
  adapters: ReadonlyMap<string, Adapter>;
  supports: (harness: string) => boolean;
};

export type Route =
  | { ok: true; harness: string; model: string; effort: string | null; capability: string; floor: string }
  | { ok: false; hold: boolean; reasons: string[] };

export function route(input: RouteInput): Route {
  // The floor is resolved before any candidate is looked at.
  const floor = input.unit.capability ?? input.roleDefault;
  if (floor === null || !input.order.includes(floor)) {
    return { ok: false, hold: false, reasons: [`a unidade não tem capacidade nem padrão de papel conhecido (${floor ?? "nenhum"})`] };
  }
  const rank = (capability: string): number => input.order.indexOf(capability);
  const reasons: string[] = [];
  let onlyCapability = false;
  for (const candidate of input.candidates) {
    const name = candidate.harness;
    if (!input.supports(name)) {
      reasons.push(`${name}: sem suporte no backend`);
      continue;
    }
    const adapter = input.adapters.get(name);
    if (adapter === undefined) {
      reasons.push(`${name}: sem adapter Radiant`);
      continue;
    }
    const missing = input.unit.requires.filter((term) => !adapter.provides.includes(term));
    if (missing.length > 0) {
      reasons.push(`${name}: provides.json não cobre ${missing.join(", ")}`);
      continue;
    }
    const capability = candidate.capability ?? floor;
    // A candidate below the floor, in agents.json order, is never viable:
    // no downgrade (Spec 3, item 6).
    if (rank(capability) === -1 || rank(capability) > rank(floor)) {
      reasons.push(`${name}: capacidade ${capability} abaixo do piso ${floor}`);
      onlyCapability = true;
      continue;
    }
    const model = adapter.models[capability];
    if (model === undefined) {
      reasons.push(`${name}: capabilities.json sem modelo para ${capability}`);
      continue;
    }
    return { ok: true, harness: name, model, effort: candidate.effort, capability, floor };
  }
  return { ok: false, hold: onlyCapability, reasons };
}
