// Model-based randomized testing: random sequences of register / resolve / dispose / copy are run
// against the container and a tiny reference model of the intended semantics. Seeds are fixed so
// any failure reproduces exactly (the step name carries the seed).
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { assert, assertEquals, assertRejects, assertStrictEquals } from '../test.deps.ts';
import { seededRandom } from './_helpers.ts';

type Lifetime = 'singleton' | 'transient' | 'scoped';

type Built = { regId: number; serial: number };

type ModelEntry = { regId: number; lifetime: Lifetime; lazy: boolean };

class KeyClass {}

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919);
const OPS_PER_RUN = 80;

Deno.test('Model-based randomized sequences', async (t) => {
  for (const seed of SEEDS) {
    await t.step(`seed ${seed}`, async () => {
      const rand = seededRandom(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

      const ioc = new IoCContainer();
      const keys = [ioc.Symbol('A'), ioc.Symbol('B'), KeyClass] as const;
      const names = ['$default', 'n1', 'n2'] as const;

      // Model state.
      const model = new Map<unknown, Map<string, ModelEntry>>();
      const builds = new Map<number, number>();
      const singletonValues = new Map<number, Built>();
      const disposers: { regId: number; key: unknown; name: string; dispose: () => void }[] = [];
      let nextRegId = 1;
      let serial = 0;

      const modelGet = (key: unknown, name: string) => model.get(key)?.get(name);

      for (let op = 0; op < OPS_PER_RUN; op++) {
        const roll = rand();
        const key = pick(keys);
        const name = pick(names);

        if (roll < 0.35) {
          // Register
          const lifetime = pick(['singleton', 'transient', 'scoped'] as const);
          const lazy = rand() < 0.5;
          const asyncFactory = rand() < 0.5;
          const regId = nextRegId++;

          const factory = () => {
            builds.set(regId, (builds.get(regId) ?? 0) + 1);
            const value: Built = { regId, serial: ++serial };
            return asyncFactory ? Promise.resolve(value) : value;
          };

          const opts: Record<string, unknown> = { Lazy: lazy };
          if (lifetime !== 'singleton') opts.Lifetime = lifetime;
          if (name !== '$default') opts.Name = name;

          let result: unknown;

          if (key === KeyClass) {
            // deno-lint-ignore no-explicit-any
            result = ioc.Register(KeyClass, factory as any, opts);
          } else {
            result = ioc.Register(factory, { ...opts, Type: key as symbol });
          }

          if (!model.has(key)) model.set(key, new Map());
          model.get(key)!.set(name, { regId, lifetime, lazy });

          const eager = lifetime !== 'transient' && !lazy;
          assertEquals(builds.get(regId) ?? 0, eager ? 1 : 0, `op ${op}: creation timing`);

          if (lifetime === 'scoped') {
            assertEquals(typeof result, 'function');
            disposers.push({ regId, key, name, dispose: result as () => void });
          }
        } else if (roll < 0.85) {
          // Resolve
          const entry = modelGet(key, name);
          // deno-lint-ignore no-explicit-any
          const resolve = () => ioc.Resolve(key as any, name);

          if (!entry) {
            await assertRejects(resolve, Error, 'No Service for symbol');
            continue;
          }

          const value = (await resolve()) as Built;

          assertEquals(value.regId, entry.regId, `op ${op}: resolved the current registration`);

          if (entry.lifetime === 'transient') {
            assert(
              !singletonValues.has(entry.regId) || singletonValues.get(entry.regId) !== value,
              `op ${op}: transient returned a cached value`,
            );
          } else {
            const known = singletonValues.get(entry.regId);

            if (known) {
              assertStrictEquals(value, known, `op ${op}: singleton identity`);
            } else {
              singletonValues.set(entry.regId, value);
            }

            assertEquals(builds.get(entry.regId), 1, `op ${op}: built exactly once`);
          }
        } else if (roll < 0.95) {
          // Dispose a random scoped registration (possibly already superseded or disposed).
          if (!disposers.length) continue;

          const target = pick(disposers);

          target.dispose();

          const current = modelGet(target.key, target.name);

          if (current?.regId === target.regId) {
            model.get(target.key)!.delete(target.name);
          }
        } else {
          // Copy everything into a fresh container and check it resolves identically.
          const copy = new IoCContainer();

          ioc.CopyTo(copy);

          for (const [k, bank] of model) {
            for (const [n, entry] of bank) {
              // deno-lint-ignore no-explicit-any
              const fromCopy = (await copy.Resolve(k as any, n)) as Built;

              assertEquals(
                fromCopy.regId,
                entry.regId,
                `op ${op}: copy resolves same registration`,
              );

              if (entry.lifetime !== 'transient') {
                // deno-lint-ignore no-explicit-any
                const fromOriginal = await ioc.Resolve(k as any, n);

                assertStrictEquals(fromCopy, fromOriginal, `op ${op}: copy shares singletons`);
                singletonValues.set(entry.regId, fromCopy);
              }
            }
          }
        }
      }
    });
  }
});
