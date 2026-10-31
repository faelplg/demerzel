import { isAbsolute, join } from "node:path";

export type Env = Record<string, string | undefined>;

function base(env: Env, xdg: string, fallback: string): string {
  const value = env[xdg];
  if (value !== undefined && value !== "" && isAbsolute(value)) return value;
  const home = env["HOME"];
  if (home === undefined || home === "") throw new Error(`HOME is not set and ${xdg} is not an absolute path`);
  return join(home, fallback);
}

// Spec 2.3: $XDG_STATE_HOME/demerzel, or ~/.local/state/demerzel.
export function stateRoot(env: Env): string {
  return join(base(env, "XDG_STATE_HOME", ".local/state"), "demerzel");
}

// Spec 2.4: $XDG_CONFIG_HOME/demerzel/config.json, or ~/.config/demerzel/config.json.
export function configPath(env: Env): string {
  return join(base(env, "XDG_CONFIG_HOME", ".config"), "demerzel", "config.json");
}
