import { spawn } from 'node:child_process';
import { builtinModules } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { build } from 'vite';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const desktop = join(root, 'apps/desktop');

export async function generateContracts() {
  const ajv = new Ajv({ strict: true });
  ajv.addKeyword('x-nickname');
  ajv.addKeyword('x-ttlSeconds');
  const schemas = {};
  for (const [name, filename] of Object.entries({
    admissionSchema: 'admission.schema.json',
    tokenClaimsSchema: 'token-claims.schema.json',
    permissionsSchema: 'permissions.schema.json',
  })) {
    const schema = JSON.parse(await readFile(join(root, 'packages/contracts', filename), 'utf8'));
    ajv.compile(schema);
    schemas[name] = schema;
  }
  const lines = ["import type { FromSchema } from 'json-schema-to-ts';"];
  for (const [name, schema] of Object.entries(schemas)) {
    lines.push('export const ' + name + ' = ' + JSON.stringify(schema) + ' as const;');
  }
  for (const [name, definition] of Object.entries({
    AdmissionRequest: 'request', AdmissionSuccess: 'success',
    AdmissionSummary: 'summary', AdmissionError: 'error', StartupConfiguration: 'startup',
    RendererResult: 'rendererResult',
  })) {
    lines.push('const ' + definition + 'Schema = { ...admissionSchema, $ref: "#/$defs/' + definition + '" } as const;');
    lines.push('export type ' + name + ' = FromSchema<typeof ' + definition + 'Schema>;');
  }
  lines.push('export type MediaClaims = FromSchema<typeof tokenClaimsSchema>;');
  lines.push('export type PermissionAction = FromSchema<typeof permissionsSchema>;');
  const output = join(root, 'packages/contracts/dist');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'index.ts'), lines.join('\n') + '\n');
}

function execute(tool, args) {
  return new Promise((resolvePromise, reject) => {
    const processHandle = spawn(process.execPath, [join(root, 'node_modules', tool), ...args], {
      cwd: root, stdio: 'inherit', windowsHide: true,
    });
    processHandle.on('error', reject);
    processHandle.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error('Validation command failed (' + code + ')')));
  });
}

export async function buildDesktop({ renderer = true } = {}) {
  await generateContracts();
  const external = ['electron', ...builtinModules, ...builtinModules.map((name) => 'node:' + name)];
  for (const [name, emptyOutDir] of [['main', true], ['preload', false]]) {
    await build({
      root: desktop, configFile: false, logLevel: 'warn',
      build: {
        target: 'node22', outDir: 'dist/main', emptyOutDir,
        lib: { entry: join(desktop, 'src/main/' + name + '.ts'), formats: ['cjs'], fileName: () => name + '.cjs' },
        rolldownOptions: { external },
      },
    });
  }
  if (renderer) await build({ root: desktop, configFile: join(desktop, 'vite.config.ts'), logLevel: 'warn' });
}

async function main() {
  await generateContracts();
  if (process.argv.includes('--typecheck')) {
    await execute('typescript/bin/tsc', ['-p', join(desktop, 'tsconfig.json')]);
  } else if (process.argv.includes('--lint')) {
    await execute('eslint/bin/eslint.js', ['--config', join(desktop, 'eslint.config.mjs'),
      'apps/desktop/src', 'apps/desktop/scripts', 'apps/desktop/vite.config.ts',
      'apps/desktop/playwright.config.ts', 'packages/ui/src', 'tests/shell']);
  } else {
    await buildDesktop();
    if (process.argv.includes('--test')) {
      await execute('@playwright/test/cli.js', ['test', '--config', join(desktop, 'playwright.config.ts')]);
    }
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Desktop build or validation failed.');
    process.exitCode = 1;
  });
}
