#!/usr/bin/env node
// 边界检查器 —— 拒绝越出模块 Allowed Files 的改动。零依赖。
//
// 用法：
//     git diff --name-only -z origin/main...HEAD | node .agents/scope_guard.mjs 3.1
//     node .agents/scope_guard.mjs 3.1 --files a.ts b.py
//
// 模块清单在 .agents/modules/<id>-*.md，其中 allowed-files 块形如：
//
//     <!-- allowed-files:start -->
//     apps/desktop/src/features/voice/**
//     apps/api/app/voice/**
//     <!-- allowed-files:end -->
//
// 退出码 0 = 全部在界内，1 = 有越界文件或模块 id 无效。

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const MODULES = join(REPO, ".agents", "modules");

const START = "<!-- allowed-files:start -->";
const END = "<!-- allowed-files:end -->";

function die(msg) {
  console.error(msg);
  process.exit(1);
}

/** 把 allowed-files 里的 glob 转成正则。
 *  `**` 跨目录匹配，`*` 只在单层内匹配，`?` 匹配单个非分隔符字符。 */
function globToRegex(pattern) {
  let out = "^";
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 3;
    } else if (pattern.startsWith("**", i)) {
      out += ".*";
      i += 2;
    } else if (pattern[i] === "*") {
      out += "[^/]*";
      i += 1;
    } else if (pattern[i] === "?") {
      out += "[^/]";
      i += 1;
    } else {
      out += pattern[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(out + "$");
}

function loadModule(moduleId) {
  const files = readdirSync(MODULES).filter(
    (f) => f === `${moduleId}.md` || f.startsWith(`${moduleId}-`),
  );
  if (files.length === 0) {
    const available = readdirSync(MODULES)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, "").split("-")[0])
      .join(", ");
    die(
      `scope_guard: 找不到模块 '${moduleId}'\n` +
        `  PR 正文的 \`Module:\` 字段必须是下列之一：\n  ${available}`,
    );
  }

  const name = files.sort()[0];
  const text = readFileSync(join(MODULES, name), "utf8");
  if (!text.includes(START) || !text.includes(END)) {
    die(`scope_guard: ${name} 缺少 allowed-files 标记块`);
  }

  const patterns = text
    .split(START)[1]
    .split(END)[0]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("`"));

  if (patterns.length === 0) die(`scope_guard: ${name} 的 allowed-files 块是空的`);
  return { name, patterns };
}

async function readStdin() {
  if (process.stdin.isTTY) return [];
  process.stdin.setEncoding("utf8");
  let buf = "";
  for await (const chunk of process.stdin) buf += chunk;
  if (buf.includes("\0")) return buf.split("\0").filter(Boolean);
  // 兼容手工输入的逐行列表；Git 输出必须使用 -z，避免路径转义。
  return buf
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  die(
    "用法: git diff --name-only -z origin/main...HEAD | node .agents/scope_guard.mjs <模块id>",
  );
}

const moduleId = args[0];
const flagIndex = args.indexOf("--files");
const changed = flagIndex === -1 ? await readStdin() : args.slice(flagIndex + 1);

if (changed.length === 0) {
  console.log("scope_guard: 没有改动文件，跳过");
  process.exit(0);
}

const { name, patterns } = loadModule(moduleId);
const allowed = patterns.map(globToRegex);
const violations = changed.filter((f) => !allowed.some((rx) => rx.test(f)));

console.log(`scope_guard: 模块 ${moduleId} (${name})`);
console.log(`  改动 ${changed.length} 个文件，允许范围 ${patterns.length} 条规则`);

if (violations.length > 0) {
  console.error(`\n✗ ${violations.length} 个文件越界：\n`);
  for (const f of violations) console.error(`    ${f}`);
  console.error(
    `\n  越界不进入讨论，直接拒绝。两个选项：\n` +
      `    1. 把这些改动拆成一个新 Issue（推荐）\n` +
      `    2. 如果确实属于本模块，提议修改 ${name} 的 allowed-files，\n` +
      `       并 @ Tech Lead —— 但这需要单独一个 PR（Module: docs）\n`,
  );
  process.exit(1);
}

console.log("\n✓ 全部在界内");
