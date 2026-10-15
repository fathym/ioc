import { IoCContainer, type IoCServiceKey } from '../../src/ioc/ioc.ts';
import { type IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { IoCScopeRequiredError, IoCServiceNotFoundError } from '../../src/ioc/errors.ts';
import { assert, assertEquals, assertInstanceOf, assertRejects } from '../test.deps.ts';

interface ITestClass {
  Hello: string;
}

const $ITestClass = IoCToken<ITestClass, 'ITestClass'>('ITestClass');

class TestDefaultClass implements ITestClass {
  public Hello: string = 'World';
}

class TestParamsClass implements ITestClass {
  constructor(public Hello: string) {}
}

type Lifetime = 'singleton' | 'transient' | 'scoped';

type RegistrationOptions = { Lifetime?: 'transient' | 'scoped'; Name?: string };

/** One way to register an `ITestClass`: what is registered, under which key, and what it builds. */
interface Shape {
  Label: string;

  Key: IoCServiceKey<ITestClass>;

  /** How errors name the key: the token description or the class name. */
  KeyLabel: string;

  // deno-lint-ignore no-explicit-any
  Class: new (...args: any[]) => ITestClass;

  Hello: string;

  Register(ioc: IoCContainer, options: RegistrationOptions): void;
}

// Each shape is one of the old overloaded `Register` forms: a class keyed by itself, a class keyed
// by a token (`Type`), a factory keyed by a class, and a factory keyed by a token.
const shapes: Shape[] = [
  {
    Label: 'Class key - RegisterClass',
    Key: TestDefaultClass,
    KeyLabel: 'TestDefaultClass',
    Class: TestDefaultClass,
    Hello: 'World',
    Register: (ioc, options) => ioc.RegisterClass(TestDefaultClass, options),
  },
  {
    Label: 'Token key - RegisterClass',
    Key: $ITestClass,
    KeyLabel: 'ITestClass',
    Class: TestDefaultClass,
    Hello: 'World',
    Register: (ioc, options) =>
      ioc.RegisterClass(TestDefaultClass, { ...options, Type: $ITestClass }),
  },
  {
    Label: 'Class key - RegisterFactory',
    Key: TestParamsClass,
    KeyLabel: 'TestParamsClass',
    Class: TestParamsClass,
    Hello: 'World2',
    Register: (ioc, options) =>
      ioc.RegisterFactory(TestParamsClass, () => new TestParamsClass('World2'), options),
  },
  {
    Label: 'Token key - RegisterFactory',
    Key: $ITestClass,
    KeyLabel: 'ITestClass',
    Class: TestParamsClass,
    Hello: 'World2',
    Register: (ioc, options) =>
      ioc.RegisterFactory($ITestClass, () => new TestParamsClass('World2'), options),
  },
];

const lifetimes: Lifetime[] = ['singleton', 'transient', 'scoped'];

function optionsFor(lifetime: Lifetime, name?: string): RegistrationOptions {
  return {
    ...(lifetime === 'singleton' ? {} : { Lifetime: lifetime }),
    ...(name ? { Name: name } : {}),
  };
}

/** A container that records the label of every service it builds. */
function buildCounting(): { ioc: IoCContainer; builds: string[] } {
  const builds: string[] = [];

  const ioc = new IoCContainer({
    OnEvent: (e) => {
      if (e.Type === 'build') builds.push(e.Service);
    },
  });

  return { ioc, builds };
}

/** Registers one service under each of: class, class + name, token, token + name. */
function registerClashing(ioc: IoCContainer, lifetime: Lifetime): void {
  ioc.RegisterFactory(TestParamsClass, () => new TestParamsClass('World2'), optionsFor(lifetime));

  ioc.RegisterFactory(
    TestParamsClass,
    () => new TestParamsClass('World3'),
    optionsFor(lifetime, 'test'),
  );

  ioc.RegisterFactory($ITestClass, () => new TestParamsClass('World4'), optionsFor(lifetime));

  ioc.RegisterFactory(
    $ITestClass,
    () => new TestParamsClass('World5'),
    optionsFor(lifetime, 'test'),
  );
}

Deno.test('IoC Workbench', async (t) => {
  for (const shape of shapes) {
    for (const name of [undefined, 'test']) {
      for (const lifetime of lifetimes) {
        const label = `${lifetime} - ${shape.Label} - ${name ? 'Named' : 'Unnamed'}`;

        await t.step(label, async () => {
          const { ioc, builds } = buildCounting();

          shape.Register(ioc, optionsFor(lifetime, name));

          assertEquals(builds.length, 0, 'Nothing is built at registration.');

          const scope = lifetime === 'scoped' ? ioc.CreateScope() : ioc;

          const test = await scope.Resolve(shape.Key, name);

          assertEquals(test.Hello, shape.Hello);
          assertInstanceOf(test, shape.Class);

          const testb = await scope.Resolve(shape.Key, name);

          assertEquals(testb.Hello, shape.Hello);
          assertInstanceOf(testb, shape.Class);

          if (lifetime === 'transient') {
            assert(testb !== test, 'The transient instance is equal to the other.');

            assertEquals(builds.length, 2);
          } else {
            assert(testb === test, `The ${lifetime} instance is not equal to the other.`);

            assertEquals(builds.length, 1);
          }

          if (lifetime === 'scoped') {
            const other = ioc.CreateScope();

            const testc = await other.Resolve(shape.Key, name);

            assertInstanceOf(testc, shape.Class);
            assert(testc !== test, 'The scoped instance is shared across scopes.');

            await assertRejects(() => ioc.Resolve(shape.Key, name), IoCScopeRequiredError);
          }

          if (name) {
            await assertRejects(() => scope.Resolve(shape.Key), IoCServiceNotFoundError);
          }

          assert(ioc.Unregister(shape.Key, name), 'The registration was not removed.');

          const after = lifetime === 'scoped' ? ioc.CreateScope() : ioc;

          const err = await assertRejects(
            () => after.Resolve(shape.Key, name),
            IoCServiceNotFoundError,
            'No service is registered for',
          );

          assertEquals(err.Key, shape.KeyLabel);

          await ioc.Dispose();
        });
      }
    }
  }

  await t.step('Activate builds singletons only', async () => {
    for (const shape of shapes) {
      for (const lifetime of lifetimes) {
        const { ioc, builds } = buildCounting();

        shape.Register(ioc, optionsFor(lifetime));

        assertEquals(builds.length, 0, `${shape.Label}: built at registration.`);

        await ioc.Activate();

        assertEquals(
          builds.length,
          lifetime === 'singleton' ? 1 : 0,
          `${lifetime} - ${shape.Label}: wrong build count after Activate().`,
        );

        if (lifetime === 'singleton') {
          await ioc.Resolve(shape.Key);

          assertEquals(builds.length, 1, `${shape.Label}: the singleton was built again.`);
        }

        await ioc.Dispose();
      }
    }
  });

  for (const lifetime of lifetimes) {
    await t.step(`Clash Checks - ${lifetime} - Params`, async () => {
      const ioc = new IoCContainer();

      registerClashing(ioc, lifetime);

      const scope = lifetime === 'scoped' ? ioc.CreateScope() : ioc;

      const test = await scope.Resolve(TestParamsClass);

      assertEquals(test.Hello, 'World2');
      assertInstanceOf(test, TestParamsClass);

      const testName = await scope.Resolve(TestParamsClass, 'test');

      assertEquals(testName.Hello, 'World3');
      assertInstanceOf(testName, TestParamsClass);

      const testToken = await scope.Resolve($ITestClass);

      assertEquals(testToken.Hello, 'World4');
      assertInstanceOf(testToken, TestParamsClass);

      const testTokenName = await scope.Resolve($ITestClass, 'test');

      assertEquals(testTokenName.Hello, 'World5');
      assertInstanceOf(testTokenName, TestParamsClass);

      const all = [test, testName, testToken, testTokenName];

      assertEquals(new Set(all).size, 4, `The ${lifetime} instances are clashing.`);

      // Each one keeps its own lifetime.
      const again = [
        await scope.Resolve(TestParamsClass),
        await scope.Resolve(TestParamsClass, 'test'),
        await scope.Resolve($ITestClass),
        await scope.Resolve($ITestClass, 'test'),
      ];

      again.forEach((instance, i) => {
        if (lifetime === 'transient') assert(instance !== all[i]);
        else assert(instance === all[i]);
      });

      await ioc.Dispose();
    });
  }

  await t.step('Clash Checks - Unregister - Params', async () => {
    const ioc = new IoCContainer();

    registerClashing(ioc, 'scoped');

    const keys: [IoCServiceKey<ITestClass>, string | undefined][] = [
      [TestParamsClass, undefined],
      [TestParamsClass, 'test'],
      [$ITestClass, undefined],
      [$ITestClass, 'test'],
    ];

    for (let i = 0; i < keys.length; i++) {
      const [key, name] = keys[i];

      assert(ioc.Unregister(key, name), 'The registration was not removed.');

      const scope = ioc.CreateScope();

      await assertRejects(
        () => scope.Resolve(key, name),
        IoCServiceNotFoundError,
        undefined,
        'The scoped registration was not removed.',
      );

      for (const [restKey, restName] of keys.slice(i + 1)) {
        assertInstanceOf(await scope.Resolve(restKey, restName), TestParamsClass);
      }
    }

    await ioc.Dispose();
  });

  await t.step('Clash Checks - Mixed - Params', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory(TestParamsClass, () => new TestParamsClass('World2'));

    ioc.RegisterFactory(TestParamsClass, () => new TestParamsClass('World3'), {
      Lifetime: 'transient',
      Name: 'test',
    });

    ioc.RegisterFactory($ITestClass, () => new TestParamsClass('World4'), {
      Lifetime: 'scoped',
    });

    const scope = ioc.CreateScope();

    const test = await scope.Resolve(TestParamsClass);

    assertEquals(test.Hello, 'World2');
    assertInstanceOf(test, TestParamsClass);

    const testName = await scope.Resolve(TestParamsClass, 'test');

    assertEquals(testName.Hello, 'World3');
    assertInstanceOf(testName, TestParamsClass);

    const testToken = await scope.Resolve($ITestClass);

    assertEquals(testToken.Hello, 'World4');
    assertInstanceOf(testToken, TestParamsClass);

    assert(test !== testName, 'The singleton instance is clashing with named instance.');
    assert(test !== testToken, 'The singleton instance is clashing with token instance.');
    assert(testName !== testToken, 'The named instance is clashing with token instance.');

    assert(ioc.Unregister($ITestClass));

    await assertRejects(
      () => ioc.CreateScope().Resolve($ITestClass),
      IoCServiceNotFoundError,
      undefined,
      'The scoped registration was not removed.',
    );

    const testB = await ioc.Resolve(TestParamsClass);

    const testNameB = await ioc.Resolve(TestParamsClass, 'test');

    assert(test === testB, 'The singleton is shared between the scope and the root.');
    assert(test !== testNameB);
    assert(testName !== testNameB);

    await ioc.Dispose();
  });

  // 0.x shared registrations with `CopyTo`; 1.0 shares them through a module.
  await t.step('Shared registrations - Module', async () => {
    const Shared: IoCModule = {
      Name: 'Shared',
      Register: (m) => {
        m.RegisterFactory(TestParamsClass, () => new TestParamsClass('WorldB'), { Replace: true });

        m.RegisterFactory(TestParamsClass, () => new TestParamsClass('WorldB'), {
          Name: 'test',
          Replace: true,
        });

        m.RegisterFactory($ITestClass, () => new TestParamsClass('WorldB'), {
          Name: 'test',
          Replace: true,
        });

        m.RegisterFactory($ITestClass, () => new TestParamsClass('World2B'), { Name: 'test2' });
      },
    };

    const ioc = new IoCContainer();

    ioc.RegisterFactory(TestDefaultClass, () => new TestDefaultClass());

    // The app's own registrations are sealed against modules; as defaults, a module may replace
    // them.
    ioc.RegisterFactory(TestParamsClass, () => new TestParamsClass('WorldA'), { Default: true });

    ioc.RegisterFactory(TestParamsClass, () => new TestParamsClass('WorldA'), {
      Lifetime: 'transient',
      Name: 'test',
      Default: true,
    });

    ioc.RegisterFactory($ITestClass, () => new TestDefaultClass(), {
      Name: 'test',
      Default: true,
    });

    ioc.Use(Shared);

    const testDef = await ioc.Resolve(TestDefaultClass);

    assertEquals(testDef.Hello, 'World');
    assertInstanceOf(testDef, TestDefaultClass);

    const test = await ioc.Resolve(TestParamsClass);

    assertEquals(test.Hello, 'WorldB');
    assertInstanceOf(test, TestParamsClass);

    const testName = await ioc.Resolve(TestParamsClass, 'test');

    const testName2 = await ioc.Resolve(TestParamsClass, 'test');

    assertEquals(testName.Hello, 'WorldB');
    assertEquals(testName2.Hello, 'WorldB');
    assertInstanceOf(testName, TestParamsClass);
    assert(testName === testName2, 'The shared registration did not replace the transient.');

    const testTokenName = await ioc.Resolve($ITestClass, 'test');

    assertEquals(testTokenName.Hello, 'WorldB');
    assertInstanceOf(testTokenName, TestParamsClass);

    const test2TokenName = await ioc.Resolve($ITestClass, 'test2');

    assertEquals(test2TokenName.Hello, 'World2B');
    assertInstanceOf(test2TokenName, TestParamsClass);

    // The same module shares the same registrations with another container.
    const iocB = new IoCContainer().Use(Shared);

    assertEquals((await iocB.Resolve($ITestClass, 'test2')).Hello, 'World2B');
    assertEquals((await iocB.Resolve(TestParamsClass)).Hello, 'WorldB');

    await iocB.Dispose();

    await ioc.Dispose();
  });
});
