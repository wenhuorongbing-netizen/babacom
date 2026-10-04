import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("./scope_guard.mjs", import.meta.url));

function gitChangedFiles(paths) {
  const tempRoot = resolve(tmpdir());
  const repo = mkdtempSync(join(tempRoot, "babacom-scope-guard-"));
  try {
    const git = (args) => {
      const result = spawnSync("git", args, { cwd: repo, timeout: 10_000 });
      assert.equal(result.status, 0, result.stderr?.toString() || String(result.error));
      return result.stdout;
    };
    git(["init", "--quiet"]);
    for (const path of paths) {
      const file = join(repo, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "fixture\n");
    }
    git(["add", "--", ...paths]);
    return git(["-c", "core.quotePath=true", "diff", "--cached", "--name-only", "-z"]);
  } finally {
    assert.equal(dirname(repo), tempRoot);
    assert.ok(basename(repo).startsWith("babacom-scope-guard-"));
    rmSync(repo, { recursive: true, force: true });
  }
}

function check(input, args = ["docs"]) {
  return spawnSync(process.execPath, [guard, ...args], {
    input,
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("accepts a Chinese document path from Git's NUL-delimited output", () => {
  const result = check(gitChangedFiles(["docs/中文.md"]));
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

test("rejects a source path mixed with an allowed Chinese document", () => {
  const result = check(gitChangedFiles(["docs/中文.md", "packages/shared/src/index.ts"]));
  assert.equal(result.status, 1, result.stdout || String(result.error));
  assert.match(result.stderr, /packages\/shared\/src\/index\.ts/);
});

test("checks each Chinese document in a Git change list separately", () => {
  const result = check(gitChangedFiles(["docs/中文.md", "docs/说明.md"]));
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /改动 2 个文件/);
});

test("does not trim a NUL-delimited filename into an allowed exact path", () => {
  const result = check(".gitignore \0");
  assert.equal(result.status, 1, result.stdout || String(result.error));
});

test("accepts an allowed Chinese document through --files", () => {
  const result = check("", ["docs", "--files", "docs/中文.md"]);
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

test("rejects a source path through --files", () => {
  const result = check("", ["docs", "--files", "packages/shared/src/index.ts"]);
  assert.equal(result.status, 1, result.stdout || String(result.error));
});

test("keeps accepting manually supplied plain newline-separated paths", () => {
  const result = check("docs/one.md\ndocs/two.md\n");
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /改动 2 个文件/);
});
