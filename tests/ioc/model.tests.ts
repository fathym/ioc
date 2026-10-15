// Model-based randomized testing: random sequences of register / resolve / unregister / activate /
// scope checks are run against the container and a tiny reference model of the intended semantics.
// Seeds are fixed so any failure reproduces exactly (the step name carries the seed).
import {
  IoCDuplicateRegistrationError,
  IoCScopeRequiredError,
  IoCServiceNotFoundError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from '../test.deps.ts';
import { seededRandom } from './_helpers.ts';

type Lifetime = 'singleton' | 'transient' | 'scoped';

type Built = { regId: number; serial: number };

type ModelEntry = { regId: number; lifetime: Lifetime };

class KeyClass {}

const $A = IoCToken<Built>('A');
const $B = IoCToken<Built>('B');

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919);
const OPS_PER_RUN = 80;

Deno.test('Model-based randomized sequences', async (t) => {
  for (const seed of SEEDS) {
    await t.step(`seed ${seed}`, async () => {
      const rand = seededRandom(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

      const ioc = new IoCContainer();
      const keys = [$A, $B, KeyClass] as const;
      const names = ['$default', 'n1', 'n2'] as const;

      // Scoped services are resolved from this long-lived scope; the root refuses them.
      await using scope = ioc.CreateScope();

      // Model state.
      const model = new Map<unknown, Map<string, ModelEntry>>();
      const builds = new Map<number, number>();
      const expectedBuilds = new Map<number, number>();
      const cachedValues = new Map<number, Built>();
      let nextRegId = 1;
      let serial = 0;

      const modelGet = (key: unknown, name: string) => model.get(key)?.get(name);

      const entries = () =>
        [...model].flatMap(([key, bank]) =>
          [...bank].map(([name, entry]) => ({ key, name, entry }))
        );

      for (let op = 0; op < OPS_PER_RUN; op++) {
        const roll = rand();
        const key = pick(keys);
        const name = pick(names);

        if (roll < 0.35) {
          // Register (Replace: true over an existing registration, except sometimes on purpose).
          const lifetime = pick(['singleton', 'transient', 'scoped'] as const);
          const asyncFactory = rand() < 0.5;
          const existing = modelGet(key, name);
          const replace = !!existing && rand() < 0.8;
          const regId = nextRegId++;

          const factory = () => {
            builds.set(regId, (builds.get(regId) ?? 0) + 1);
            const value: Built = { regId, serial: ++serial };
            return asyncFactory ? Promise.resolve(value) : value;
          };

          const opts: { Lifetime?: 'transient' | 'scoped'; Name?: string; Replace?: boolean } = {};
          if (lifetime !== 'singleton') opts.Lifetime = lifetime;
          if (name !== '$default') opts.Name = name;
          if (replace) opts.Replace = true;

          const register = () => ioc.RegisterFactory(key, factory, opts);

          if (existing && !replace) {
            assertThrows(register, IoCDuplicateRegistrationError);
            continue;
          }

          register();

          if (!model.has(key)) model.set(key, new Map());
          model.get(key)!.set(name, { regId, lifetime });

          assertEquals(builds.get(regId) ?? 0, 0, `op ${op}: nothing is built at registration`);
        } else if (roll < 0.8) {
          // Resolve
          const entry = modelGet(key, name);
          const from = entry?.lifetime === 'scoped' ? scope : ioc;
          const resolve = () => from.Resolve(key, name);

          if (!entry) {
            await assertRejects(resolve, IoCServiceNotFoundError);
            continue;
          }

          if (entry.lifetime === 'scoped') {
            await assertRejects(
              () => ioc.Resolve(key, name),
              IoCScopeRequiredError,
              undefined,
              `op ${op}: scoped needs a scope`,
            );
          }

          const value = (await resolve()) as Built;

          assertEquals(value.regId, entry.regId, `op ${op}: resolved the current registration`);

          if (entry.lifetime === 'transient') {
            expectedBuilds.set(entry.regId, (expectedBuilds.get(entry.regId) ?? 0) + 1);
            assert(
              cachedValues.get(entry.regId) !== value,
              `op ${op}: transient returned a cached value`,
            );
          } else {
            const known = cachedValues.get(entry.regId);

            if (known) {
              assertStrictEquals(value, known, `op ${op}: cached identity`);
            } else {
              cachedValues.set(entry.regId, value);
              expectedBuilds.set(entry.regId, (expectedBuilds.get(entry.regId) ?? 0) + 1);
            }
          }

          assertEquals(
            builds.get(entry.regId),
            expectedBuilds.get(entry.regId),
            `op ${op}: build count`,
          );
        } else if (roll < 0.9) {
          // Unregister a random key and name (possibly not registered).
          const removed = ioc.Unregister(key, name);

          assertEquals(removed, !!modelGet(key, name), `op ${op}: Unregister result`);

          model.get(key)?.delete(name);
        } else if (roll < 0.95) {
          // Activate builds every unbuilt singleton, and nothing else.
          await ioc.Activate();

          for (const { key: k, name: n, entry } of entries()) {
            if (entry.lifetime === 'singleton' && !cachedValues.has(entry.regId)) {
              // deno-lint-ignore no-explicit-any
              cachedValues.set(entry.regId, (await ioc.Resolve(k as any, n)) as Built);
              expectedBuilds.set(entry.regId, 1);
            }
          }

          for (const [regId, count] of builds) {
            assertEquals(count, expectedBuilds.get(regId) ?? 0, `op ${op}: Activate build count`);
          }
        } else {
          // A fresh scope shares singletons, builds its own scoped instances, and sees every
          // registration the root has.
          await using fresh = ioc.CreateScope();

          for (const { key: k, name: n, entry } of entries()) {
            // deno-lint-ignore no-explicit-any
            const fromFresh = (await fresh.Resolve(k as any, n)) as Built;

            assertEquals(
              fromFresh.regId,
              entry.regId,
              `op ${op}: scope resolves same registration`,
            );

            if (entry.lifetime === 'singleton') {
              // deno-lint-ignore no-explicit-any
              const fromRoot = await ioc.Resolve(k as any, n);

              assertStrictEquals(fromFresh, fromRoot, `op ${op}: scope shares singletons`);

              if (!cachedValues.has(entry.regId)) {
                cachedValues.set(entry.regId, fromFresh);
                expectedBuilds.set(entry.regId, 1);
              }
            } else {
              assertNotStrictEquals(
                fromFresh,
                cachedValues.get(entry.regId),
                `op ${op}: scope gets its own ${entry.lifetime} instance`,
              );

              expectedBuilds.set(entry.regId, (expectedBuilds.get(entry.regId) ?? 0) + 1);
            }

            assertEquals(builds.get(entry.regId), expectedBuilds.get(entry.regId));
          }
        }
      }
    });
  }
});
