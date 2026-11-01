/**
 * Measures the published library's footprint: the whole package bundled and minified with
 * `deno bundle`, then gzipped. With `--compare`, measures the other containers in the README's
 * comparison table the same way, at pinned versions, so the numbers can be re-run at each release.
 *
 *   deno task size              # @fathym/ioc only
 *   deno task size --compare    # and InversifyJS, tsyringe, awilix and NestJS
 */

/** Each library's whole public API, with the polyfill it requires at runtime. */
const LIBRARIES: [string, string][] = [
  ['@fathym/ioc', `export * from '${new URL('../mod.ts', import.meta.url).href}';`],
  [
    'InversifyJS 8.2.3',
    "import 'npm:reflect-metadata@0.2.2'; export * from 'npm:inversify@8.2.3';",
  ],
  ['tsyringe 4.10.0', "import 'npm:reflect-metadata@0.2.2'; export * from 'npm:tsyringe@4.10.0';"],
  ['awilix 13.0.5', "export * from 'npm:awilix@13.0.5';"],
  [
    'NestJS 12.3.2 (core + common)',
    "import 'npm:reflect-metadata@0.2.2'; export * from 'npm:@nestjs/core@12.3.2'; " +
    "export * from 'npm:@nestjs/common@12.3.2';",
  ],
];

const compare = Deno.args.includes('--compare');

const dir = await Deno.makeTempDir({ prefix: 'ioc-size-' });

async function gzipSize(bytes: Uint8Array<ArrayBuffer>): Promise<number> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));

  return (await new Response(stream).arrayBuffer()).byteLength;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

const rows: string[][] = [];

try {
  for (const [name, source] of compare ? LIBRARIES : LIBRARIES.slice(0, 1)) {
    const entry = `${dir}/entry.ts`;

    const out = `${dir}/out.js`;

    await Deno.writeTextFile(entry, source);

    const { code, stderr } = await new Deno.Command(Deno.execPath(), {
      // NestJS loads its optional packages (microservices, websockets, ...) only when installed.
      args: [
        'bundle',
        '--quiet',
        '--minify',
        '--platform=deno',
        '--external=@nestjs/microservices',
        '--external=@nestjs/websockets',
        '--external=@nestjs/platform-express',
        '--external=class-validator',
        '--external=class-transformer',
        '-o',
        out,
        entry,
      ],
      stdout: 'null',
      stderr: 'piped',
    }).output();

    if (code !== 0) {
      console.error(`${name}: bundle failed\n${new TextDecoder().decode(stderr)}`);
      Deno.exitCode = 1;
      continue;
    }

    const bytes = await Deno.readFile(out);

    rows.push([name, kb(bytes.byteLength), kb(await gzipSize(bytes))]);
  }
} finally {
  await Deno.remove(dir, { recursive: true });
}

const width = Math.max(...rows.map(([name]) => name.length));

console.log(`${'Library'.padEnd(width)}  ${'Minified'.padStart(9)}  ${'Gzipped'.padStart(9)}`);

for (const [name, min, gz] of rows) {
  console.log(`${name.padEnd(width)}  ${min.padStart(9)}  ${gz.padStart(9)}`);
}
