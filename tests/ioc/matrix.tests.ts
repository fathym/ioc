// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
// Generated coverage: every combination of lifetime x Activate() x registration form x name, plus
// every lifetime x form seen through scopes, registered directly or by a module. Nothing is built
// at registration; Activate() builds the singletons (and only those) up front.
import { IoCScopeRequiredError, IoCServiceNotFoundError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from '../test.deps.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

class Impl {
  public static built = 0;

  constructor(public label = 'class') {
    Impl.built++;
  }
}

const $IImpl = IoCToken<Impl, 'IImpl'>('IImpl');

const lifetimes = ['singleton', 'transient', 'scoped'] as const;
const activations = [false, true] as const;
const names = [undefined, 'named'] as const;

type Form = {
  label: string;
  register: (ioc: IoCContainer, opts: Record<string, unknown>) => unknown;
  key: typeof Impl | typeof $IImpl;
  expectedLabel: string;
};

const forms: Form[] = [
  {
    label: 'class only',
    register: (ioc, opts) => ioc.RegisterClass(Impl, opts),
    key: Impl,
    expectedLabel: 'class',
  },
  {
    label: 'class + sync factory',
    register: (ioc, opts) => ioc.RegisterFactory(Impl, () => new Impl('sync'), opts),
    key: Impl,
    expectedLabel: 'sync',
  },
  {
    label: 'class + async factory',
    register: (ioc, opts) =>
      ioc.RegisterFactory(Impl, async () => {
        await Promise.resolve();
        return new Impl('async');
      }, opts),
    key: Impl,
    expectedLabel: 'async',
  },
  {
    label: 'token + sync factory',
    register: (ioc, opts) => ioc.RegisterFactory($IImpl, () => new Impl('tok-sync'), opts),
    key: $IImpl,
    expectedLabel: 'tok-sync',
  },
  {
    label: 'token + async factory',
    register: (ioc, opts) => ioc.RegisterFactory($IImpl, async () => new Impl('tok-async'), opts),
    key: $IImpl,
    expectedLabel: 'tok-async',
  },
  {
    label: 'class under interface token',
    register: (ioc, opts) => ioc.RegisterClass(Impl, { ...opts, Type: $IImpl }),
    key: $IImpl,
    expectedLabel: 'class',
  },
];

Deno.test('Matrix', async (t) => {
  for (const lifetime of lifetimes) {
    for (const activate of activations) {
      for (const form of forms) {
        for (const name of names) {
          const title = `${lifetime}${activate ? ':activated' : ''} | ${form.label} | ${
            name ?? 'default'
          }`;

          await t.step(title, async () => {
            const ioc = new IoCContainer();
            const opts: Record<string, unknown> = {};

            if (lifetime !== 'singleton') opts.Lifetime = lifetime;
            if (name) opts.Name = name;

            Impl.built = 0;

            const result = form.register(ioc, opts);

            assertStrictEquals(result, ioc, 'registration returns the container');

            // Let any stray async work run: nothing may be built at registration.
            await new Promise((r) => setTimeout(r, 0));

            assertEquals(Impl.built, 0, 'nothing is built at registration');

            if (activate) {
              await ioc.Activate();

              assertEquals(
                Impl.built,
                lifetime === 'singleton' ? 1 : 0,
                'Activate() builds singletons only',
              );
            }

            await using scope = ioc.CreateScope();

            // Scoped services need a scope; the others resolve the same from either.
            const from: Any = lifetime === 'scoped' ? scope : ioc;

            const resolve = () => (name ? from.Resolve(form.key, name) : from.Resolve(form.key));

            if (lifetime === 'scoped') {
              await assertRejects(
                () => (name ? ioc.Resolve(form.key, name) : ioc.Resolve(form.key)),
                IoCScopeRequiredError,
              );
            }

            const [a, b, c] = await Promise.all([resolve(), resolve(), resolve()]);
            const d = await resolve();

            assertInstanceOf(a, Impl);
            assertEquals(a.label, form.expectedLabel);

            if (lifetime === 'transient') {
              assertEquals(new Set([a, b, c, d]).size, 4, 'transient instances are distinct');
            } else {
              assertStrictEquals(a, b);
              assertStrictEquals(b, c);
              assertStrictEquals(c, d);
            }

            if (name) {
              await assertRejects(
                () => from.Resolve(form.key),
                IoCServiceNotFoundError,
                'No service is registered for',
              );
            }

            assert(ioc.Unregister(form.key, name));

            await assertRejects(() => resolve(), IoCServiceNotFoundError);

            if (lifetime !== 'transient') {
              assert(Impl.built <= 1, `built ${Impl.built} times`);
            }
          });
        }
      }
    }
  }
});

Deno.test('Matrix - lifetimes across scopes, registered directly or by a module', async (t) => {
  for (const via of ['direct', 'module'] as const) {
    for (const lifetime of lifetimes) {
      for (const form of forms) {
        await t.step(`${via} | ${lifetime} | ${form.label}`, async () => {
          const opts: Record<string, unknown> = {};

          if (lifetime !== 'singleton') opts.Lifetime = lifetime;

          const module: IoCModule = {
            Name: 'Impls',
            Register: (view) => form.register(view, opts),
          };

          const ioc = new IoCContainer();

          if (via === 'module') ioc.Use(module);
          else form.register(ioc, opts);

          await using first = ioc.CreateScope();
          await using second = ioc.CreateScope();

          const fromFirst = await first.Resolve(form.key);
          const fromFirstAgain = await first.Resolve(form.key);
          const fromSecond = await second.Resolve(form.key);

          assertInstanceOf(fromFirst, Impl);
          assertEquals(fromFirst.label, form.expectedLabel);

          if (lifetime === 'transient') {
            assertNotStrictEquals(fromFirst, fromFirstAgain);
            assertNotStrictEquals(fromFirst, fromSecond);
          } else if (lifetime === 'scoped') {
            assertStrictEquals(fromFirst, fromFirstAgain);
            assertNotStrictEquals(fromFirst, fromSecond);
            await assertRejects(() => ioc.Resolve(form.key), IoCScopeRequiredError);
          } else {
            assertStrictEquals(fromFirst, fromFirstAgain);
            assertStrictEquals(fromFirst, fromSecond);
            assertStrictEquals(fromFirst, await ioc.Resolve(form.key));
          }

          assertEquals(ioc.Describe().Services[0].Module, via === 'module' ? 'Impls' : undefined);
        });
      }
    }
  }
});
