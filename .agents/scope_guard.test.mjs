import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("./scope_guard.mjs", import.meta.url));
const workflow = readFileSync(new URL("../.github/workflows/scope-guard.yml", import.meta.url), "utf8");
const diffLine = workflow.match(/^\s*git diff ([^\r\n]*?)\s*\\\r?$/m);
if (!diffLine) throw new Error("Cannot find the CI Git diff producer");
const diffOptions = diffLine[1].trim().split(/\s+/);

function gitChangedFiles(paths, renameTo) {
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
    if (renameTo) {
      assert.equal(paths.length, 1);
      const commit = (message) => git([
        "-c", "user.name=scope-guard-test",
        "-c", "user.email=scope-guard-test@example.invalid",
        "-c", `core.hooksPath=${join(repo, "no-hooks")}`,
        "commit", "--quiet", "--no-gpg-sign", "-m", message,
      ]);
      commit("fixture base");
      const target = resolve(repo, renameTo);
      assert.ok(resolve(repo, paths[0]).startsWith(repo + sep));
      assert.ok(target.startsWith(repo + sep));
      mkdirSync(dirname(target), { recursive: true });
      git(["mv", "--", paths[0], renameTo]);
      commit("fixture rename");
      return git(["-c", "diff.renames=true", "diff", ...diffOptions, "HEAD~1...HEAD"]);
    }
    return git(["-c", "core.quotePath=true", "diff", "--cached", ...diffOptions]);
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

test("accepts the line ending PowerShell appends after Git's final NUL", () => {
  const input = Buffer.concat([gitChangedFiles(["docs/one.md", "docs/two.md"]), Buffer.from("\r\n")]);
  const result = check(input);
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

test("rejects an out-of-scope rename source using the actual CI diff options", () => {
  const input = gitChangedFiles(["AGENTS.md"], "apps/desktop/src/features/voice/AGENTS.md");
  const result = check(input, ["3.1"]);
  assert.equal(result.status, 1, result.stdout || String(result.error));
  assert.match(result.stderr, /^\s+AGENTS\.md\r?$/m);
});

test("accepts both paths of an in-scope rename using the actual CI diff options", () => {
  const input = gitChangedFiles(["apps/desktop/src/features/voice/old.ts"], "apps/desktop/src/features/voice/new.ts");
  const result = check(input, ["3.1"]);
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /改动 2 个文件/);
});
