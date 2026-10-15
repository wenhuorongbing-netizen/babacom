import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("./scope_guard.mjs", import.meta.url));
const workflow = readFileSync(new URL("../.github/workflows/scope-guard.yml", import.meta.url), "utf8");
const declaredOptions = workflow.match(/const diffOptions = (\[[^\r\n]+\]);/);
if (!declaredOptions) throw new Error("Cannot find the CI Git diff producer");
const diffOptions = JSON.parse(declaredOptions[1]);

function workflowJob(name) {
  const source = workflow.match(new RegExp(`\\n  ${name}:\\r?\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:|$)`))?.[1];
  assert.ok(source, `Missing workflow job: ${name}`);
  return source;
}

function stepScript(source, identifier) {
  const marker = source.indexOf(identifier);
  assert.notEqual(marker, -1, `Missing workflow step: ${identifier}`);
  const match = source.slice(marker).match(/\n        run: \|\r?\n((?:          [^\r\n]*\r?\n|\r?\n)+)/);
  assert.ok(match, `Missing inline workflow script: ${identifier}`);
  return match[1].replace(/^          /gm, "");
}

// Exercise the workflow's own entry point against real base/head Git commits.
function workflowFixture(changes, options = {}) {
  const tempRoot = resolve(tmpdir());
  const root = mkdtempSync(join(tempRoot, "babacom-trusted-scope-"));
  const source = join(root, "source");
  const checkout = join(root, "trusted");
  const marker = join(root, "candidate-executed");
  const git = (cwd, args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result.stdout.trim();
  };
  const write = (relative, contents) => {
    const path = resolve(source, relative);
    assert.ok(path.startsWith(source + sep), `Fixture path escapes repository: ${relative}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  try {
    mkdirSync(source);
    git(source, ["init", "--quiet", "--initial-branch=main"]);
    git(source, ["config", "user.name", "scope-guard-test"]);
    git(source, ["config", "user.email", "scope-guard-test@example.invalid"]);
    git(source, ["config", "core.hooksPath", join(root, "no-hooks")]);
    git(source, ["config", "commit.gpgSign", "false"]);
    write(".agents/scope_guard.mjs", readFileSync(guard));
    write(".agents/modules/docs.md", "<!-- allowed-files:start -->\ndocs/**\n.agents/**\n.github/**\n*.md\n<!-- allowed-files:end -->\n");
    write(".github/workflows/scope-guard.yml", workflow);
    write("docs/base.md", "base\n");
    write("apps/product.ts", "base\n");
    git(source, ["add", "."]);
    git(source, ["commit", "--quiet", "--no-gpg-sign", "-m", "fixture base"]);
    const base = git(source, ["rev-parse", "HEAD"]);
    changes({ write, marker, source, git });
    git(source, ["add", "-A"]);
    git(source, ["commit", "--quiet", "--no-gpg-sign", "-m", "fixture candidate"]);
    const head = git(source, ["rev-parse", "HEAD"]);
    git(source, ["update-ref", "refs/pull/7/head", head]);
    git(source, ["update-ref", "refs/heads/main", base]);
    git(root, ["clone", "--quiet", "--no-checkout", source, checkout]);
    git(checkout, ["config", "core.hooksPath", join(root, "no-hooks")]);

    const scopeJob = workflowJob("scope");
    const checkoutRef = scopeJob.match(/^          ref: (.+)$/m)?.[1].trim();
    const revision = checkoutRef === "${{ github.event.pull_request.base.sha }}" ? base : head;
    assert.ok(!checkoutRef || checkoutRef === "${{ github.event.pull_request.base.sha }}" ||
      checkoutRef === "${{ github.event.pull_request.head.sha }}", `Unsupported checkout ref: ${checkoutRef}`);
    git(checkout, ["checkout", "--quiet", "--detach", revision]);
    git(checkout, ["update-ref", "refs/remotes/origin/main", base]);
    const env = { ...process.env, BASE_SHA: base, HEAD_SHA: head, PR_NUMBER: "7",
      PR_BODY: "Module: docs\n", ...options.env };
    options.prepare?.({ source, checkout, root, base, head, git, write, env });
    const entry = join(root, "workflow-entry.cjs");
    writeFileSync(entry, stepScript(scopeJob, "id: trusted_scope"));
    const result = spawnSync(process.execPath, [entry], { cwd: checkout, env, encoding: "utf8", timeout: 20_000 });
    return { ...result, markerExecuted: existsSync(marker), base, head };
  } finally {
    assert.equal(dirname(root), tempRoot);
    assert.ok(basename(root).startsWith("babacom-trusted-scope-"));
    rmSync(root, { recursive: true, force: true });
  }
}

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

test("workflow rejects a candidate that expands its own docs policy and changes product code", () => {
  const result = workflowFixture(({ write }) => {
    write(".agents/modules/docs.md", "<!-- allowed-files:start -->\n**\n<!-- allowed-files:end -->\n");
    write("apps/product.ts", "candidate\n");
  });
  assert.equal(result.status, 1, result.stdout || result.stderr || String(result.error));
  assert.match(result.stderr, /apps\/product\.ts/);
});

test("workflow accepts Chinese and space-containing documents with a pinned base/head receipt", () => {
  const result = workflowFixture(({ write }) => {
    write("docs/中文 说明.md", "candidate\n");
    write("docs/other document.md", "candidate\n");
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /改动 2 个文件/);
  assert.ok(result.stdout.includes(result.base), "Missing trusted base SHA receipt");
  assert.ok(result.stdout.includes(result.head), "Missing candidate head SHA receipt");
});

test("workflow never executes a candidate replacement of the guard", () => {
  const result = workflowFixture(({ write, marker }) => {
    write(".agents/scope_guard.mjs", `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "executed");\nprocess.exit(0);\n`);
    write("apps/product.ts", "candidate\n");
  });
  assert.equal(result.markerExecuted, false, "Candidate guard was executed");
  assert.equal(result.status, 1, result.stdout || result.stderr || String(result.error));
  assert.match(result.stderr, /apps\/product\.ts/);
});

test("workflow never executes a candidate replacement of the workflow", () => {
  const result = workflowFixture(({ write, marker }) => {
    write(".github/workflows/scope-guard.yml", `name: candidate\non: pull_request_target\njobs:\n  scope:\n    steps:\n      - run: node -e 'require("fs").writeFileSync(${JSON.stringify(marker)}, "executed")'\n`);
    write("apps/product.ts", "candidate\n");
  });
  assert.equal(result.markerExecuted, false, "Candidate workflow was executed");
  assert.equal(result.status, 1, result.stdout || result.stderr || String(result.error));
  assert.match(result.stderr, /apps\/product\.ts/);
});

test("workflow allows a policy-only proposal without making its new product allowance effective", () => {
  const result = workflowFixture(({ write }) => {
    write(".agents/modules/docs.md", "<!-- allowed-files:start -->\ndocs/**\n.agents/**\napps/**\n<!-- allowed-files:end -->\n");
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /改动 1 个文件/);
});

test("workflow rejects the deleted source of an out-of-scope rename", () => {
  const result = workflowFixture(({ source, git }) => {
    git(source, ["mv", "--", "apps/product.ts", "docs/moved.md"]);
  });
  assert.equal(result.status, 1, result.stdout || result.stderr || String(result.error));
  assert.match(result.stderr, /apps\/product\.ts/);
});

test("workflow accepts both ends of an in-scope rename", () => {
  const result = workflowFixture(({ source, git }) => {
    git(source, ["mv", "--", "docs/base.md", "docs/中文 新名.md"]);
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /改动 2 个文件/);
});

for (const [name, env] of [
  ["missing base SHA", { BASE_SHA: "" }],
  ["invalid base SHA", { BASE_SHA: "main; exit 0" }],
  ["missing head SHA", { HEAD_SHA: "" }],
  ["invalid head SHA", { HEAD_SHA: "HEAD" }],
  ["unknown base commit", { BASE_SHA: "1".repeat(40) }],
  ["unknown candidate commit", { HEAD_SHA: "2".repeat(40) }],
  ["missing PR number", { PR_NUMBER: "" }],
  ["invalid PR number", { PR_NUMBER: "7; exit 0" }],
  ["missing module", { PR_BODY: "No module declaration\n" }],
  ["unknown module", { PR_BODY: "Module: missing-module\n" }],
  ["path traversal module", { PR_BODY: "Module: ../docs\n" }],
]) {
  test(`workflow fails closed for ${name}`, () => {
    const result = workflowFixture(({ write }) => write("docs/change.md", "candidate\n"), { env });
    assert.equal(result.status, 1, result.stdout || result.stderr || String(result.error));
  });
}

test("workflow fails closed when the fetched PR ref changes after the event", () => {
  const result = workflowFixture(({ write }) => write("docs/change.md", "candidate\n"), {
    prepare: ({ source, base, git }) => git(source, ["update-ref", "refs/pull/7/head", base]),
  });
  assert.equal(result.status, 1, result.stdout || result.stderr || String(result.error));
});

test("workflow fails closed when the PR ref cannot be fetched", () => {
  const result = workflowFixture(({ write }) => write("docs/change.md", "candidate\n"), {
    prepare: ({ source, git }) => git(source, ["update-ref", "-d", "refs/pull/7/head"]),
  });
  assert.equal(result.status, 1, result.stdout || result.stderr || String(result.error));
});

test("workflow fails closed when checkout does not match the event base", () => {
  const result = workflowFixture(({ write }) => write("docs/change.md", "candidate\n"), {
    prepare: ({ checkout, head, git }) => git(checkout, ["checkout", "--quiet", "--detach", head]),
  });
  assert.equal(result.status, 1, result.stdout || result.stderr || String(result.error));
});

test("workflow fails closed when a valid fetched candidate has no merge base", () => {
  const result = workflowFixture(({ write }) => write("docs/change.md", "candidate\n"), {
    prepare: ({ source, git, write, env }) => {
      git(source, ["checkout", "--quiet", "--orphan", "unrelated"]);
      git(source, ["rm", "--quiet", "-r", "--cached", "."]);
      write("docs/unrelated.md", "unrelated history\n");
      git(source, ["add", "--", "docs/unrelated.md"]);
      git(source, ["commit", "--quiet", "--no-gpg-sign", "-m", "fixture unrelated root"]);
      const orphan = git(source, ["rev-parse", "HEAD"]);
      git(source, ["update-ref", "refs/pull/7/head", orphan]);
      env.HEAD_SHA = orphan;
    },
  });
  assert.equal(result.status, 1, result.stdout || result.stderr || String(result.error));
  assert.match(result.stderr, /no merge base/);
});

test("workflow treats module and PR-body command substitutions as data", () => {
  const result = workflowFixture(({ write }) => write("docs/change.md", "candidate\n"), {
    env: { PR_BODY: "Module: docs$(exit 0)\n${{ secrets.GITHUB_TOKEN }}\n" },
  });
  assert.equal(result.status, 1, result.stdout || result.stderr || String(result.error));
});

test("workflow accepts shell-like prose outside a valid module declaration as data", () => {
  const result = workflowFixture(({ write }) => write("docs/change.md", "candidate\n"), {
    env: { PR_BODY: "$(exit 1)\nModule: docs\n${{ secrets.GITHUB_TOKEN }}\n" },
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});
