import { spawn } from 'node:child_process';
import { builtinModules } from 'node:module';
import { cp, mkdtemp, readFile, mkdir, unlink, writeFile } from 'node:fs/promises';
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
    mediaSessionSchema: 'media-session.schema.json',
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
  for (const [name, definition] of Object.entries({
    MediaStartup: 'mediaStartup', MediaSnapshot: 'snapshot', MediaCommand: 'command',
    MediaRuntimeCommand: 'runtimeCommand', MediaRuntimeEvent: 'runtimeEvent',
  })) {
    lines.push('const media' + definition + 'Schema = { ...mediaSessionSchema, $ref: "#/$defs/' + definition + '" } as const;');
    lines.push('export type ' + name + ' = FromSchema<typeof media' + definition + 'Schema>;');
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


export async function buildMediaPeer() {
  await build({
    root: desktop, configFile: false, logLevel: 'warn',
    build: {
      target: 'node22', outDir: 'build', emptyOutDir: false,
      lib: { entry: join(root, 'tests/voice/sfu-peer.ts'), formats: ['cjs'], fileName: () => 'sfu-peer.cjs' },
      rolldownOptions: { external: ['electron'] },
    },
  });
}

export async function buildDesktop({ renderer = true } = {}) {
  await generateContracts();
  const external = ['electron', ...builtinModules, ...builtinModules.map((name) => 'node:' + name)];
  for (const [name, emptyOutDir] of [['main', true], ['preload', false], ['media-preload', false]]) {
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
  await mkdir(join(desktop, 'dist/media'), { recursive: true });
  await cp(join(desktop, 'media.html'), join(desktop, 'dist/media/media.html'));
  await buildMediaPeer();
}

export async function packageWindows() {
  if (process.platform !== 'win32') throw new Error('Windows packaging requires Windows');
  await mkdir(join(desktop, 'build'), { recursive: true });
  const staging = await mkdtemp(join(desktop, 'build/package-'));
  await cp(join(desktop, 'dist'), join(staging, 'dist'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8'));
  await writeFile(join(staging, 'package.json'), JSON.stringify({
    name: 'babacom', version: manifest.version, main: manifest.main,
    description: 'BabaCom controlled admission client', author: 'BabaCom contributors',
  }) + '\n');
  const { build: packageBuild } = await import('electron-builder');
  await packageBuild({
    projectDir: desktop,
    config: {
      extends: join(desktop, 'electron-builder.yml'), directories: { app: staging },
      afterPack: async ({ appOutDir }) => {
        if (resolve(appOutDir) !== resolve(desktop, 'build/windows/win-unpacked')) throw new Error('Unexpected package output');
        // The supplied Electron runtime includes its development entry app.
        await unlink(join(appOutDir, 'resources/default_app.asar')).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      },
    },
  });
}

async function main() {
  await generateContracts();
  if (process.argv.includes('--typecheck')) {
    await execute('typescript/bin/tsc', ['-p', join(desktop, 'tsconfig.json')]);
  } else if (process.argv.includes('--lint')) {
    await execute('eslint/bin/eslint.js', ['--config', join(desktop, 'eslint.config.mjs'),
      'apps/desktop/src', 'apps/desktop/scripts', 'apps/desktop/vite.config.ts',
      'apps/desktop/playwright.config.ts', 'packages/ui/src', 'tests/shell', 'tests/voice', 'tests/audio']);
  } else {
    if (process.argv.includes('--test-packaged')) {
      await execute('@playwright/test/cli.js', ['test', '--config', join(desktop, 'playwright.config.ts'), '--project', 'packaged']);
      return;
    }
    await buildDesktop();
    if (process.argv.includes('--package-win')) await packageWindows();
    if (process.argv.includes('--test')) {
      await execute('@playwright/test/cli.js', ['test', '--config', join(desktop, 'playwright.config.ts'), '--project', 'development']);
    }
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Desktop build or validation failed.');
    process.exitCode = 1;
  });
}
