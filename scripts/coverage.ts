/**
 * Runs the test suite with coverage and reports it for the library source (`src/`), failing
 * below the floors. In CI it also writes the table to the job summary.
 *
 *   deno task coverage
 */

/** The lowest coverage CI accepts. Raise them as coverage grows; never lower them to pass. */
const FLOORS = { Line: 97, Branch: 95 };

const root = decodeURIComponent(new URL('../', import.meta.url).pathname);

const cov = `${root}cov`;

async function deno(args: string[], capture = false): Promise<string> {
  const output = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: root,
    stdout: capture ? 'piped' : 'inherit',
    stderr: capture ? 'piped' : 'inherit',
  }).output();

  if (output.code !== 0) {
    if (capture) console.error(new TextDecoder().decode(output.stderr));
    throw new Error(`deno ${args.join(' ')} failed (${output.code})`);
  }

  return capture ? new TextDecoder().decode(output.stdout) : '';
}

await Deno.remove(cov, { recursive: true }).catch(() => {});

await deno(['test', '-A', '--quiet', 'tests/tests.ts', '--parallel', `--coverage=${cov}`]);

// deno coverage prints a Markdown-style table; strip colors and keep it as is.
const table = (await deno(['coverage', cov, '--include=^file://.*/src/', '--exclude=tests/'], true))
  .replace(/\x1b\[[0-9;]*m/g, '')
  .trim();

const total = table.split('\n').find((line) => line.includes('All files'));

if (!total) throw new Error(`No "All files" row in the coverage report:\n${table}`);

const [branch, fn, line] = total.split('|').map((cell) => cell.trim()).filter(Boolean).slice(1)
  .map(Number);

const failures = [
  line < FLOORS.Line ? `line coverage ${line}% is below the ${FLOORS.Line}% floor` : '',
  branch < FLOORS.Branch ? `branch coverage ${branch}% is below the ${FLOORS.Branch}% floor` : '',
].filter(Boolean);

const summary = [
  '## Test coverage (`src/`)',
  '',
  `**Lines ${line}% · branches ${branch}% · functions ${fn}%** (floors: lines ${FLOORS.Line}%, ` +
  `branches ${FLOORS.Branch}%)`,
  '',
  table,
  '',
].join('\n');

console.log(summary);

const step = Deno.env.get('GITHUB_STEP_SUMMARY');

if (step) await Deno.writeTextFile(step, summary, { append: true });

if (failures.length) {
  console.error(failures.map((f) => `Coverage check failed: ${f}.`).join('\n'));
  Deno.exit(1);
}
