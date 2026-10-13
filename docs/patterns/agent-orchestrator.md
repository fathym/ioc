---
FrontmatterVersion: 1
DocumentType: Guide
Title: Agent Orchestrator
Summary: Run agents and sub-agents in parallel - each in its own scope with private memory, shared tools and clients, nested sub-agent scopes, and cleanup when each agent finishes.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Patterns
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ../../AGENTS.md
---

# Agent Orchestrator

> **Goal:** An orchestrator that runs agents (and agents that spawn sub-agents), concurrently.
> Each agent has private state (memory, scratch files, budget) but shares the expensive things
> (model clients, tool registries). When an agent finishes, its state is cleaned up.

## The shape

- **The root** registers everything once: shared clients and tools as singletons, per-agent
  state as singletons too.
- **Each agent runs in `CreateScope({ Level: 'agent' }).Isolate(...)`**: the scope gets its own
  copy of the per-agent services and shares the rest. The isolated services' dependencies come
  from the agent scope, so an agent's memory can read the agent's own settings.
- **A sub-agent is a scope of its parent agent's scope.** It isolates what it must not share
  with its parent, and inherits the rest, including anything the parent isolated.
- **`await using`** disposes the agent's state when its run ends, even on failure.

Without real scopes, "isolated" sub-units often share the parent's container and leak state into
each other. `Isolate` makes the boundary explicit and checkable with `Describe()`.

## Example

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface ModelClient {
  complete(prompt: string): Promise<string>;
}

const $Model = IoCToken<ModelClient, 'Agents.Model'>('Agents.Model');
const $Role = IoCToken<string, 'Agents.Role'>('Agents.Role');

class Memory {
  public notes: string[] = [];
  public disposed = false;
  [Symbol.dispose]() {
    this.disposed = true;
  }
}

class Agent {
  constructor(private model: ModelClient, private memory: Memory, private role: string) {}

  async step(task: string) {
    const answer = await this.model.complete(`${this.role}: ${task}`);
    this.memory.notes.push(answer);
    return answer;
  }
}

let calls = 0;

const root = IoCContainer.Create()
  .RegisterValue($Model, { complete: (p) => Promise.resolve(`done(${p}) #${++calls}`) })
  .RegisterClass(Memory)
  .RegisterClass(Agent, { Deps: [$Model, Memory, $Role], Lifetime: 'transient' });

async function runAgent(parent: IoCContainer, role: string, task: string) {
  await using scope = parent.CreateScope({ Level: 'agent' })
    .RegisterValue($Role, role)
    .Isolate(Memory);

  const agent = await scope.Resolve(Agent);

  await agent.step(task);

  // A sub-agent: its own memory, the same model client.
  if (role === 'planner') await runAgent(scope, 'researcher', `research ${task}`);

  return (await scope.Resolve(Memory)).notes;
}

const [planner, writer] = await Promise.all([
  runAgent(root, 'planner', 'outline'),
  runAgent(root, 'writer', 'draft'),
]);

console.log(planner.length, writer.length); // 1 1: nothing leaked between agents
console.log(calls); // 3: one shared client served all three agents
```

## Rules

- **Isolate state, share capabilities.** Memory, budgets, conversation history and working
  directories are isolated; model clients, tool registries and caches are shared.
- **Register per-agent values on the agent scope** (`$Role`, the task, the budget), not on the
  root.
- **Prefer `Isolate` over re-registering by hand:** it keeps the root's recipe (dependencies,
  `Dispose` option, decorators), so the agent's copy behaves like the original.
- **Use `ScopeLevel: 'agent'`** for services that every sub-agent of one agent should share (a
  run-wide scratchpad), instead of isolating them at each level.
- **Bound concurrency outside the container.** Scopes are cheap, but the work they do isn't.

## What's Next

- `Isolate` and levels: [scopes.md](../concepts/scopes.md#isolating-services-in-a-scope) _[Explanation]_
- Tools as plugins: [resolver-chains.md](./resolver-chains.md) _[How-to]_
- Testing agents with fakes: [testing.md](./testing.md) _[How-to]_
