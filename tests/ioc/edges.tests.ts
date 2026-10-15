import { IoCValidationError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { assert, assertEquals, assertThrows } from '../test.deps.ts';

Deno.test('Edge cases', async (t) => {
  await t.step('RegisterClass rejects non-function values', () => {
    const ioc = new IoCContainer();
    const untyped = ioc as unknown as { RegisterClass(value: unknown): unknown };

    assertThrows(() => untyped.RegisterClass({}), Error, 'expects a class');
  });

  await t.step('an anonymous class is its own key', async () => {
    const ioc = new IoCContainer();
    const Anon = (() => class {})();
    const Other = (() => class {})();

    ioc.RegisterClass(Anon);
    ioc.RegisterClass(Other);

    assert((await ioc.Resolve(Anon)) instanceof Anon);
    assert(!((await ioc.Resolve(Other)) instanceof Anon));
    assertEquals(ioc.Describe().Services.map((s) => s.Label), [
      '(anonymous class)',
      '(anonymous class)',
    ]);
  });

  await t.step('Validate sees both same-named classes (they are different keys)', () => {
    const First = (() =>
      class Svc {
        constructor(public dep: unknown) {}
      })();
    const Second = (() => class Svc {})();

    const ioc = new IoCContainer();

    ioc.RegisterClass(First);
    ioc.RegisterClass(Second);

    const err = assertThrows(() => ioc.Validate(), IoCValidationError);

    assertEquals(err.Problems.length, 1);
    assertEquals(err.Issues[0].Kind, 'arguments');
    assertEquals(ioc.Describe().Services.filter((s) => s.Label === 'Svc').length, 2);
  });
});
