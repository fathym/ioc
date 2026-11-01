/**
 * Proves the package works outside Deno:
 *
 * 1. builds the npm package (`dist/npm`);
 * 2. runs `tests/runtimes/smoke.mjs` on Node.js and Bun against the build, and on Deno against
 *    the source;
 * 3. type-checks `tests/runtimes/consumer.mts` against the build's declarations with the oldest
 *    supported TypeScript and the latest, using a minimal `lib` and full lib checking.
 *
 *   deno task test:runtimes              # skips Node.js or Bun if not installed
 *   deno task test:runtimes --require-all
 */
import { buildNpm, TSC } from './build-npm.ts';

/** The oldest TypeScript the published declarations support (`NoInfer` needs 5.4). */
const OLDEST_TS = 'npm:typescript@5.4.5/tsc';

const requireAll = Deno.args.includes('--require-all');

const root = decodeURIComponent(new URL('../', import.meta.url).pathname);

async function exec(cmd: string, args: string[]): Promise<boolean> {
  try {
    const { code } = await new Deno.Command(cmd, { args, cwd: root }).spawn().status;
    return code === 0;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      if (requireAll) throw new Error(`${cmd} is not installed`);
      console.log(`skipped: ${cmd} is not installed`);
      return true;
    }
    throw err;
  }
}

await buildNpm();

const failures: string[] = [];

const steps: [string, string, string[]][] = [
  ['Node.js (build)', 'node', ['tests/runtimes/smoke.mjs', './dist/npm/esm/mod.js']],
  ['Bun (build)', 'bun', ['tests/runtimes/smoke.mjs', './dist/npm/esm/mod.js']],
  ['Bun (source)', 'bun', ['tests/runtimes/smoke.mjs', './mod.ts']],
  ['Deno (source)', Deno.execPath(), ['run', '-A', 'tests/runtimes/smoke.mjs', './mod.ts']],
];

for (const tsc of [OLDEST_TS, TSC]) {
  steps.push([
    `types with ${tsc}`,
    Deno.execPath(),
    [
      'run',
      '-A',
      tsc,
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      'false',
      '--target',
      'ES2022',
      '--module',
      'ES2022',
      '--moduleResolution',
      'bundler',
      '--lib',
      'ES2022',
      'tests/runtimes/consumer.mts',
    ],
  ]);
}

for (const [label, cmd, args] of steps) {
  console.log(`\n▶ ${label}`);
  if (!(await exec(cmd, args))) failures.push(label);
}

if (failures.length) {
  console.error(`\nRuntime checks failed: ${failures.join(', ')}`);
  Deno.exit(1);
}

console.log('\nRuntime checks passed.');
