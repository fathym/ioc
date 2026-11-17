/**
 * The AI coding benchmark: gives Claude Code the same DI tasks in the same app, written with
 * `@fathym/ioc` or with another container, and scores each run by type-check plus a hidden test.
 *
 * Arms (see the AI plan, workstream 1A):
 *   A  InversifyJS, the model's own knowledge only
 *   C  @fathym/ioc, the model's own knowledge only
 *   D  @fathym/ioc, with llms-full.txt in the project
 *   F  @fathym/ioc, with the @fathym/ioc MCP knowledge server
 *
 *   deno run -A evals/run.ts --tasks=add-provider,fix-wiring,per-session --arms=A,C,D,F \
 *     --runs=3 --parallel=4 --model=claude-sonnet-5-5
 *
 * Each run happens in a fresh temporary project. Web tools are disabled, no MCP servers load
 * except the arm's own, and Bash is limited to `deno`. After the agent finishes, the task's hidden
 * `check.test.ts` is copied in, and the run passes when `deno task check` and the test both pass.
 */
import { copy } from 'jsr:@std/fs@1.0.24/copy';

type Arm = { Id: string; Library: 'ioc' | 'inversify'; Label: string };

const ARMS: Record<string, Arm> = {
  A: { Id: 'A', Library: 'inversify', Label: 'InversifyJS, memory only' },
  C: { Id: 'C', Library: 'ioc', Label: '@fathym/ioc, memory only' },
  D: { Id: 'D', Library: 'ioc', Label: '@fathym/ioc + llms-full.txt' },
  F: { Id: 'F', Library: 'ioc', Label: '@fathym/ioc + MCP knowledge server' },
};

type Result = {
  Task: string;
  Arm: string;
  Run: number;
  Pass: boolean;
  Compiles: boolean;
  TestPasses: boolean;
  Turns?: number;
  CostUsd?: number;
  DurationMs?: number;
  McpCalls: number;
  ToolCalls: number;
  Error?: string;
};

const arg = (name: string, fallback: string) =>
  Deno.args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const root = new URL('../', import.meta.url).pathname;

const tasks = arg('tasks', 'add-provider,fix-wiring,per-session').split(',');
const arms = arg('arms', 'A,C,D,F').split(',').map((a) => ARMS[a]).filter(Boolean);
const runs = Number(arg('runs', '3'));
const parallel = Number(arg('parallel', '4'));
const model = arg('model', 'claude-sonnet-5-5');
const maxTurns = arg('max-turns', '40');
const out = arg('out', `${root}evals/results/pilot-${new Date().toISOString().slice(0, 10)}.json`);

const deno = Deno.execPath();

const env = { ...Deno.env.toObject(), PATH: `${deno.replace(/\/[^/]+$/, '')}:${Deno.env.get('PATH')}` };

async function sh(cmd: string, args: string[], cwd: string, timeoutMs: number) {
  const child = new Deno.Command(cmd, { args, cwd, env, stdout: 'piped', stderr: 'piped' }).spawn();

  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

  try {
    const { code, stdout, stderr } = await child.output();

    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runOne(task: string, arm: Arm, run: number): Promise<Result> {
  const dir = await Deno.makeTempDir({ prefix: `ioc-eval-${task}-${arm.Id}-` });

  const result: Result = {
    Task: task,
    Arm: arm.Id,
    Run: run,
    Pass: false,
    Compiles: false,
    TestPasses: false,
    McpCalls: 0,
    ToolCalls: 0,
  };

  try {
    await copy(`${root}evals/tasks/${task}/${arm.Library}`, dir, { overwrite: true });

    let prompt = await Deno.readTextFile(`${root}evals/tasks/${task}/prompt.txt`);

    prompt += '\n\nWork only inside the current directory.';

    const args = [
      '-p',
      '--model',
      model,
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      maxTurns,
      '--permission-mode',
      'acceptEdits',
      '--strict-mcp-config',
      '--disallowedTools',
      'WebFetch',
      'WebSearch',
      'Task',
      '--allowedTools',
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(deno:*)',
    ];

    if (arm.Id === 'D') {
      await Deno.copyFile(`${root}llms-full.txt`, `${dir}/llms-full.txt`);

      prompt += ' The DI library\'s complete documentation is in ./llms-full.txt.';
    }

    if (arm.Id === 'F') {
      await Deno.writeTextFile(
        `${dir}/.mcp-eval.json`,
        JSON.stringify({
          mcpServers: {
            'fathym-ioc': { command: deno, args: ['run', '-A', `${root}src/mcp/.exports.ts`] },
          },
        }),
      );

      args.push('mcp__fathym-ioc', '--mcp-config', `${dir}/.mcp-eval.json`);

      prompt += ' An MCP server, fathym-ioc, can look up @fathym/ioc examples, API and errors.';
    }

    args.splice(1, 0, prompt);

    const agent = await sh('claude', args, dir, 15 * 60_000);

    for (const line of agent.stdout.split('\n')) {
      if (!line.trim()) continue;

      let event: Record<string, unknown>;

      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event.type === 'assistant') {
        const content = ((event.message as { content?: unknown[] })?.content ?? []) as {
          type: string;
          name?: string;
        }[];

        for (const c of content) {
          if (c.type !== 'tool_use') continue;

          result.ToolCalls++;

          if (c.name?.startsWith('mcp__fathym-ioc')) result.McpCalls++;
        }
      }

      if (event.type === 'result') {
        result.Turns = event.num_turns as number;
        result.CostUsd = event.total_cost_usd as number;
        result.DurationMs = event.duration_ms as number;
      }
    }

    if (agent.code !== 0 && result.Turns === undefined) {
      result.Error = agent.stderr.slice(-500) || `claude exited ${agent.code}`;
    }

    // Score: the hidden test replaces anything the agent wrote under that name.
    await Deno.copyFile(`${root}evals/tasks/${task}/check.test.ts`, `${dir}/check.test.ts`);

    result.Compiles = (await sh(deno, ['task', 'check'], dir, 120_000)).code === 0;

    result.TestPasses =
      (await sh(deno, ['test', '-A', '--no-check', 'check.test.ts'], dir, 120_000)).code === 0;

    result.Pass = result.Compiles && result.TestPasses;
  } catch (err) {
    result.Error = String(err);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }

  return result;
}

const jobs: [string, Arm, number][] = [];

for (let run = 1; run <= runs; run++) {
  for (const task of tasks) for (const arm of arms) jobs.push([task, arm, run]);
}

const results: Result[] = [];

let next = 0;

await Promise.all(
  Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
    while (next < jobs.length) {
      const [task, arm, run] = jobs[next++];

      const r = await runOne(task, arm, run);

      results.push(r);

      console.log(
        `${r.Pass ? 'PASS' : 'FAIL'} ${task} ${arm.Id} #${run} compiles=${r.Compiles} ` +
          `test=${r.TestPasses} turns=${r.Turns ?? '?'} mcp=${r.McpCalls} cost=${
            r.CostUsd?.toFixed(3) ?? '?'
          }${r.Error ? ` error=${r.Error.slice(0, 120)}` : ''}`,
      );

      await Deno.mkdir(out.replace(/\/[^/]+$/, ''), { recursive: true });

      await Deno.writeTextFile(out, JSON.stringify({ Model: model, Results: results }, null, 2));
    }
  }),
);

console.log(`\nModel: ${model}\n`);
console.log('| Arm | Task | Passed | Avg turns | Avg cost (USD) | MCP calls |');
console.log('| --- | --- | ---: | ---: | ---: | ---: |');

for (const arm of arms) {
  for (const task of tasks) {
    const rs = results.filter((r) => r.Arm === arm.Id && r.Task === task);

    const avg = (f: (r: Result) => number | undefined) => {
      const xs = rs.map(f).filter((x): x is number => typeof x === 'number');
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
    };

    console.log(
      `| ${arm.Id} (${arm.Label}) | ${task} | ${rs.filter((r) => r.Pass).length}/${rs.length} | ` +
        `${avg((r) => r.Turns).toFixed(1)} | ${avg((r) => r.CostUsd).toFixed(3)} | ` +
        `${avg((r) => r.McpCalls).toFixed(1)} |`,
    );
  }
}
