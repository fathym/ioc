import { IoCValidationError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { assertEquals, assertStrictEquals, assertThrows } from '../test.deps.ts';

Deno.test('Edge cases', async (t) => {
  await t.step(
    'a stored thunk called directly (as an older container would) resolves',
    async () => {
      const ioc = new IoCContainer();

      class Svc {}

      ioc.Register(Svc);

      const thunk = ioc.ResolveDirect(Svc) as unknown as () => unknown;

      assertEquals(thunk.name, '');
      assertStrictEquals(await thunk(), await ioc.Resolve(Svc));
    },
  );

  await t.step('RegisterClass rejects non-function values', () => {
    const ioc = new IoCContainer();
    const untyped = ioc as unknown as { RegisterClass(value: unknown): unknown };

    assertThrows(() => untyped.RegisterClass({}), Error, 'expects a class');
  });

  await t.step('RegisterClass of an anonymous class needs a Type', () => {
    const ioc = new IoCContainer();
    const Anon = (() => class {})();

    assertThrows(() => ioc.RegisterClass(Anon), Error, 'The Type was missing');
  });

  await t.step('Validate sees shadowed same-named class registrations', () => {
    const First = (() =>
      class Svc {
        constructor(public dep: unknown) {}
      })();
    const Second = (() => class Svc {})();

    const ioc = new IoCContainer();

    ioc.Register(First);
    ioc.Register(Second);

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems.length, 1);
  });
});
