/**
 * Builds the npm package into `dist/npm`: ESM JavaScript and `.d.ts` files compiled by the
 * TypeScript compiler from the same sources JSR publishes, plus `package.json`, README, LICENSE and
 * CHANGELOG.
 *
 *   deno task build:npm                 # version from deno.jsonc
 *   deno task build:npm --version=0.1.0 # explicit version
 *
 * Publish with `npm publish dist/npm --access public`.
 */
import { parse as parseJsonc } from 'jsr:@std/jsonc@1.0.2';

/** The TypeScript compiler used for the build (pinned for reproducible output). */
export const TSC = 'npm:typescript@5.9.3/tsc';

const root = new URL('../', import.meta.url);

const out = new URL('dist/npm/', root);

function path(url: URL): string {
  return decodeURIComponent(url.pathname);
}

async function run(args: string[]): Promise<void> {
  const { code } = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: path(root),
    stdout: 'inherit',
    stderr: 'inherit',
  }).output();

  if (code !== 0) throw new Error(`Command failed (${code}): deno ${args.join(' ')}`);
}

export async function buildNpm(version?: string): Promise<URL> {
  const config = parseJsonc(await Deno.readTextFile(new URL('deno.jsonc', root))) as {
    name: string;
    version: string;
  };

  await Deno.remove(out, { recursive: true }).catch(() => {});
  await Deno.mkdir(out, { recursive: true });

  const tsconfig = new URL('dist/tsconfig.npm.json', root);

  await Deno.writeTextFile(
    tsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ES2022',
          moduleResolution: 'Bundler',
          // No DOM: the package must not depend on browser globals.
          lib: ['ES2022', 'ESNext.Disposable'],
          strict: true,
          declaration: true,
          isolatedModules: true,
          rewriteRelativeImportExtensions: true,
          noEmitOnError: true,
          rootDir: '..',
          outDir: './npm/esm',
        },
        files: ['../mod.ts'],
      },
      null,
      2,
    ),
  );

  await run(['run', '-A', TSC, '-p', path(tsconfig)]);

  await Deno.remove(tsconfig);

  // Consumers whose `lib` lacks `esnext.disposable` would otherwise fail on
  // `[Symbol.asyncDispose]` in the declarations. JSR rejects this directive in source, so it is
  // added to the npm build only.
  const dts = new URL('esm/src/ioc/ioc.d.ts', out);

  await Deno.writeTextFile(
    dts,
    `/// <reference lib="esnext.disposable" />\n${await Deno.readTextFile(dts)}`,
  );

  const pkg = {
    name: config.name,
    version: version ?? config.version,
    description: 'Small, async-first, decorator-free dependency injection for TypeScript.',
    license: 'MIT',
    repository: { type: 'git', url: 'git+https://github.com/fathym/ioc.git' },
    homepage: 'https://github.com/fathym/ioc#readme',
    bugs: 'https://github.com/fathym/ioc/issues',
    keywords: ['dependency-injection', 'di', 'ioc', 'container', 'typescript', 'deno', 'bun'],
    type: 'module',
    sideEffects: false,
    engines: { node: '>=20' },
    exports: {
      '.': { types: './esm/mod.d.ts', default: './esm/mod.js' },
      './package.json': './package.json',
    },
    main: './esm/mod.js',
    types: './esm/mod.d.ts',
    files: ['esm/', 'README.md', 'LICENSE', 'CHANGELOG.md'],
  };

  await Deno.writeTextFile(new URL('package.json', out), `${JSON.stringify(pkg, null, 2)}\n`);

  for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
    await Deno.copyFile(new URL(file, root), new URL(file, out));
  }

  return out;
}

if (import.meta.main) {
  const version = Deno.args.find((a) => a.startsWith('--version='))?.slice('--version='.length);

  const dir = await buildNpm(version);

  console.log(`Built the npm package in ${path(dir)}`);
}
