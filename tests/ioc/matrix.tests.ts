// Async functions without await are deliberate here: they produce promise-returning factories.
// deno-lint-ignore-file require-await
// Generated coverage: every combination of lifetime x lazy x registration form x name, run against
// the frozen 0.0.36 container and the current one. Identity semantics (same instance vs new
// instance, dispose) must match between the two; creation timing is checked for the current
// container only (0.0.36 ignored Lazy for factories).
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { LegacyIoCContainer } from '../fixtures/legacy-ioc.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
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

const lifetimes = ['singleton', 'transient', 'scoped'] as const;
const lazies = [false, true] as const;
const names = [undefined, 'named'] as const;

type Form = {
  label: string;
  register: (ioc: Any, opts: Record<string, unknown>) => unknown;
  key: (ioc: Any) => Any;
  expectedLabel: string;
};

const forms: Form[] = [
  {
    label: 'class only',
    register: (ioc, opts) => ioc.Register(Impl, opts),
    key: () => Impl,
    expectedLabel: 'class',
  },
  {
    label: 'class + sync factory',
    register: (ioc, opts) => ioc.Register(Impl, () => new Impl('sync'), opts),
    key: () => Impl,
    expectedLabel: 'sync',
  },
  {
    label: 'class + async factory',
    register: (ioc, opts) =>
      ioc.Register(Impl, async () => {
        await Promise.resolve();
        return new Impl('async');
      }, opts),
    key: () => Impl,
    expectedLabel: 'async',
  },
  {
    label: 'symbol + sync factory',
    register: (ioc, opts) =>
      ioc.Register(() => new Impl('sym-sync'), { ...opts, Type: ioc.Symbol('IImpl') }),
    key: (ioc) => ioc.Symbol('IImpl'),
    expectedLabel: 'sym-sync',
  },
  {
    label: 'symbol + async factory',
    register: (ioc, opts) =>
      ioc.Register(async () => new Impl('sym-async'), { ...opts, Type: ioc.Symbol('IImpl') }),
    key: (ioc) => ioc.Symbol('IImpl'),
    expectedLabel: 'sym-async',
  },
  {
    label: 'class under interface symbol',
    register: (ioc, opts) => ioc.Register(Impl, { ...opts, Type: ioc.Symbol('IImpl') }),
    key: (ioc) => ioc.Symbol('IImpl'),
    expectedLabel: 'class',
  },
];

const impls: [string, () => Any][] = [
  ['legacy', () => new LegacyIoCContainer()],
  ['current', () => new IoCContainer()],
];

for (const [implLabel, create] of impls) {
  Deno.test(`Matrix (${implLabel})`, async (t) => {
    for (const lifetime of lifetimes) {
      for (const lazy of lazies) {
        for (const form of forms) {
          for (const name of names) {
            const title = `${lifetime}${lazy ? ':lazy' : ''} | ${form.label} | ${
              name ?? 'default'
            }`;

            await t.step(title, async () => {
              const ioc = create();
              const opts: Record<string, unknown> = {};

              if (lifetime !== 'singleton') opts.Lifetime = lifetime;
              if (lazy) opts.Lazy = true;
              if (name) opts.Name = name;

              Impl.built = 0;

              const result = form.register(ioc, opts);

              if (implLabel === 'current') {
                // Let eager async factories reach their constructor call.
                await new Promise((r) => setTimeout(r, 0));

                const expectBuiltNow = lifetime !== 'transient' && !lazy;

                assertEquals(Impl.built, expectBuiltNow ? 1 : 0, 'creation timing');
              }

              const resolve =
                () => (name ? ioc.Resolve(form.key(ioc), name) : ioc.Resolve(form.key(ioc)));

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
                  () => ioc.Resolve(form.key(ioc)),
                  Error,
                  'No Service for symbol',
                );
              }

              if (lifetime === 'scoped') {
                assertEquals(typeof result, 'function');
                (result as () => void)();
                await assertRejects(() => resolve(), Error, 'No Service for symbol');
              } else {
                assertEquals(result, undefined);
              }

              if (implLabel === 'current' && lifetime !== 'transient') {
                assert(Impl.built <= 1, `built ${Impl.built} times`);
              }
            });
          }
        }
      }
    }
  });
}

Deno.test('Matrix - CopyTo preserves lifetime semantics (current)', async (t) => {
  for (const lifetime of lifetimes) {
    for (const lazy of lazies) {
      for (const form of forms) {
        await t.step(`${lifetime}${lazy ? ':lazy' : ''} | ${form.label}`, async () => {
          const source = new IoCContainer();
          const target = new IoCContainer();
          const opts: Record<string, unknown> = {};

          if (lifetime !== 'singleton') opts.Lifetime = lifetime;
          if (lazy) opts.Lazy = true;

          form.register(source, opts);
          source.CopyTo(target);

          const fromTarget = await target.Resolve(form.key(target));
          const fromSource = await source.Resolve(form.key(source));

          assertInstanceOf(fromTarget, Impl);

          if (lifetime === 'transient') {
            assert(fromTarget !== fromSource);
          } else {
            assertStrictEquals(fromTarget, fromSource);
          }
        });
      }
    }
  }
});
