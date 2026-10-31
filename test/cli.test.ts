import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

const bin = fileURLToPath(new URL(`../${pkg.bin.demerzel}`, import.meta.url));

async function run(...args: string[]) {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("demerzel entrypoint", () => {
  // Protects: the bin declared in package.json runs as an executable and
  // reports the package version. Fails if the shebang, the exec bit or the
  // version source breaks.
  test("--version prints the package version and exits 0", async () => {
    const r = await run("--version");
    expect(r).toEqual({ code: 0, stdout: `${pkg.version}\n`, stderr: "" });
  });

  // Protects: commands of later increments are refused without effect, with
  // the exit code for a refusal. Fails if an unknown command is accepted.
  test.each([[[]], [["dispatch", "TC-0001.1"]], [["--version", "--json"]], [["--help"]]])(
    "refuses %j with exit 2 and says what to do",
    async (args) => {
      const r = await run(...args);
      expect(r.code).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("demerzel --version");
    },
  );
});
