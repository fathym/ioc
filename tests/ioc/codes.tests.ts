// Error codes and container options.
import {
  IoCActivationError,
  IoCCircularDependencyError,
  IoCContainerDisposedError,
  IoCDisposeError,
  type IoCErrorCode,
  IoCLevelError,
  IoCRegistrationError,
  IoCSealedError,
  IoCServiceNotFoundError,
  IoCValidationError,
  isIoCError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from '../test.deps.ts';

async function codeOf(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }

  return undefined;
}

/**
 * One way to make the container throw each code. Typed as a `Record` over `IoCErrorCode`, so a
 * code added to the union without a producer here fails to compile.
 */
const producers: Record<IoCErrorCode, () => unknown> = {
  IOC_SERVICE_NOT_FOUND: () => new IoCContainer().Resolve(IoCToken('CodesMissing')),

  IOC_CONTAINER_DISPOSED: async () => {
    const ioc = new IoCContainer();

    await ioc.Dispose();

    return ioc.Resolve(IoCToken('CodesAfterDispose'));
  },

  IOC_CIRCULAR_DEPENDENCY: () => {
    const $A = IoCToken<number>('CodesA');
    const $B = IoCToken<number>('CodesB');

    const ioc = new IoCContainer()
      .RegisterFactory($A, async (c) => await c.Resolve($B))
      .RegisterFactory($B, async (c) => await c.Resolve($A));

    return ioc.Resolve($A);
  },

  IOC_VALIDATION_FAILED: () => {
    class NeedsArgs {
      constructor(public x: number) {}
    }

    return new IoCContainer().RegisterClass(NeedsArgs).Validate();
  },

  IOC_ACTIVATION_FAILED: () =>
    new IoCContainer()
      .RegisterFactory(IoCToken('CodesBoom'), () => Promise.reject(new Error('boom')))
      .Activate(),

  IOC_DISPOSE_FAILED: async () => {
    class Exploding {
      [Symbol.dispose]() {
        throw new Error('nope');
      }
    }

    const ioc = new IoCContainer().RegisterClass(Exploding);

    await ioc.Resolve(Exploding);

    return ioc.Dispose();
  },

  IOC_INVALID_REGISTRATION: () =>
    new IoCContainer().RegisterFactory(IoCToken('CodesBad'), 'x' as never),

  IOC_INVALID_KEY: () => new IoCContainer().Resolve('CodesString' as never),

  IOC_SCOPE_REQUIRED: () => {
    class PerRequest {}

    return new IoCContainer().RegisterClass(PerRequest, { Lifetime: 'scoped' }).Resolve(
      PerRequest,
    );
  },

  IOC_DUPLICATE_REGISTRATION: () => {
    const $Twice = IoCToken<number>('CodesTwice');

    return new IoCContainer().RegisterValue($Twice, 1).RegisterValue($Twice, 2);
  },

  IOC_SEALED: () => new IoCContainer().Override(IoCToken<number>('CodesOverride'), 1),

  IOC_ACCESS_DENIED: () => {
    const $Hidden = IoCToken<number>('CodesHidden');

    let attempt: Promise<unknown> | undefined;

    new IoCContainer().RegisterValue($Hidden, 1).Use({
      Name: 'CodesEncapsulated',
      Encapsulated: true,
      Register: (m) => {
        attempt = m.Resolve($Hidden);
      },
    });

    return attempt;
  },

  IOC_INVALID_LEVEL: () => new IoCContainer({ Levels: ['tenant'] }).CreateScope({ Level: 'x' }),

  IOC_START_FAILED: () =>
    new IoCContainer()
      .Use({
        Name: 'CodesFailing',
        Register: () => {},
        OnStart: () => {
          throw new Error('cannot start');
        },
      })
      .Start(),

  IOC_MODULE_CYCLE: () => {
    const a: { -readonly [K in keyof IoCModule]: IoCModule[K] } = {
      Name: 'CodesA',
      Register: () => {},
    };

    const b: IoCModule = { Name: 'CodesB', Requires: [a], Register: () => {} };

    a.Requires = [b];

    return new IoCContainer().Use(a);
  },

  IOC_RESOLVE_TIMEOUT: () => {
    const $Hangs = IoCToken<number>('CodesHangs');

    return new IoCContainer({ PendingTimeoutMs: 10 })
      .RegisterFactory($Hangs, () => new Promise<number>(() => {}))
      .Resolve($Hangs);
  },

  IOC_NOT_ISOLATABLE: () => {
    const $Value = IoCToken<number>('CodesValue');

    return new IoCContainer().RegisterValue($Value, 1).CreateScope().Isolate($Value);
  },
};

Deno.test('Error codes', async (t) => {
  for (const [code, produce] of Object.entries(producers)) {
    await t.step(`${code} is produced by the container`, async () => {
      assertEquals(await codeOf(produce), code);
    });
  }

  await t.step('more ways to produce the newer codes', async () => {
    // IOC_INVALID_KEY: any non-token, non-class key, wherever a key is taken.
    assertEquals(
      await codeOf(() => new IoCContainer().Has(Symbol.for('X') as never)),
      'IOC_INVALID_KEY',
    );
    assertEquals(
      await codeOf(() => new IoCContainer().RegisterValue({} as never, 1 as never)),
      'IOC_INVALID_KEY',
    );

    // IOC_SEALED: replacing, decorating or unregistering a module's registration from outside.
    const $Owned = IoCToken<number>('CodesOwned');

    const Owner: IoCModule = {
      Name: 'CodesOwner',
      Register: (m) => m.RegisterValue($Owned, 1),
    };

    // From another module in the same container (the application itself may change anything).
    const asModule = (fn: (m: IoCContainer) => unknown) => () =>
      new IoCContainer().Use(Owner, {
        Name: 'CodesOther',
        Requires: [Owner],
        Register: (m) => void fn(m),
      });

    for (
      const [action, fn] of [
        ['replace', asModule((m) => m.RegisterValue($Owned, 2, { Replace: true }))],
        ['decorate', asModule((m) => m.Decorate($Owned, (n) => n + 1))],
        ['unregister', asModule((m) => m.Unregister($Owned))],
      ] as const
    ) {
      const err = assertThrows(fn, IoCSealedError);

      assertEquals([err.code, err.Module, err.Action], ['IOC_SEALED', 'CodesOwner', action]);
    }

    // IOC_INVALID_LEVEL: an undeclared level, a ScopeLevel nobody declared, or levels nested in
    // the wrong order.
    const levels = new IoCContainer({ Levels: ['tenant', 'request'] });

    const tooDeep = assertThrows(
      () => levels.CreateScope({ Level: 'request' }).CreateScope({ Level: 'tenant' }),
      IoCLevelError,
    );

    assertEquals([tooDeep.code, tooDeep.Level], ['IOC_INVALID_LEVEL', 'tenant']);

    assertEquals(
      await codeOf(() => new IoCContainer().RegisterClass(class Svc {}, { ScopeLevel: 'tenant' })),
      'IOC_INVALID_LEVEL',
    );
  });

  await t.step('activation and dispose failures are AggregateErrors with codes', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory(IoCToken('CodesBoom'), () => Promise.reject(new Error('boom')));

    const activation = await assertRejects(() => ioc.Activate(), IoCActivationError);

    assertInstanceOf(activation, AggregateError);
    assertEquals(activation.code, 'IOC_ACTIVATION_FAILED');
    assertEquals(activation.Services, ['CodesBoom']);
    assertEquals(activation.message, 'IoC activation failed for: CodesBoom.');

    class Exploding {
      [Symbol.dispose]() {
        throw new Error('nope');
      }
    }

    const owner = new IoCContainer().RegisterClass(Exploding);

    await owner.Resolve(Exploding);

    const disposing = await assertRejects(() => owner.Dispose(), IoCDisposeError);

    assertInstanceOf(disposing, AggregateError);
    assertEquals(disposing.code, 'IOC_DISPOSE_FAILED');
  });

  await t.step('isIoCError checks the code, not the class', () => {
    const codes: IoCErrorCode[] = ['IOC_SERVICE_NOT_FOUND', 'IOC_CIRCULAR_DEPENDENCY'];

    assert(isIoCError(new IoCServiceNotFoundError('X', '$default')));
    assert(isIoCError(new IoCCircularDependencyError(['A', 'A']), codes[1]));
    assert(!isIoCError(new IoCContainerDisposedError(), codes[0]));
    assert(isIoCError(new IoCSealedError('X', undefined, 'override'), 'IOC_SEALED'));
    assert(isIoCError(new IoCLevelError('x', 'bad level'), 'IOC_INVALID_LEVEL'));
    assert(!isIoCError(new Error('plain')));
    assert(!isIoCError(null));

    // An error from another copy of the library is recognized by its code alone.
    assert(isIoCError(Object.assign(new Error('foreign'), { code: 'IOC_SERVICE_NOT_FOUND' })));
    assert(!isIoCError(Object.assign(new Error('other'), { code: 'ENOENT' })));
  });

  await t.step('IoCServiceNotFoundError names the key by its description', () => {
    assertEquals(new IoCServiceNotFoundError('X', '$default').Key, 'X');
    assertEquals(
      new IoCServiceNotFoundError('X', '$default').message,
      'No service is registered for X.',
    );
    assertEquals(
      new IoCServiceNotFoundError('X', 'n').message,
      `No service is registered for X with name 'n'.`,
    );
  });

  await t.step('IoCValidationError keeps Problems and adds Issues', () => {
    const err = new IoCValidationError(['first problem']);

    assertEquals(err.Problems, ['first problem']);
    assertEquals(err.Issues[0].Message, 'first problem');
    assertEquals(err.message, 'IoC validation failed:\n  - first problem');
  });

  await t.step('IoCRegistrationError can carry IOC_INVALID_KEY', () => {
    assertEquals(new IoCRegistrationError('bad key', 'IOC_INVALID_KEY').code, 'IOC_INVALID_KEY');
    assertEquals(new IoCRegistrationError('bad').code, 'IOC_INVALID_REGISTRATION');
  });
});

Deno.test('Container options', async (t) => {
  await t.step(
    'with no options, singletons are built by Activate(), not at registration',
    async () => {
      let built = 0;

      class Lazy {
        constructor() {
          built++;
        }
      }

      const ioc = new IoCContainer().RegisterClass(Lazy);

      assertEquals(built, 0);

      await ioc.Activate();

      assertEquals(built, 1);
    },
  );

  await t.step('with no options, the container is strict', async () => {
    const $Url = IoCToken<string>('CodesUrl');

    class PerRequest {}

    const ioc = new IoCContainer()
      .RegisterValue($Url, 'a')
      .RegisterClass(PerRequest, { Lifetime: 'scoped' });

    assertEquals(await codeOf(() => ioc.RegisterValue($Url, 'b')), 'IOC_DUPLICATE_REGISTRATION');
    assertEquals(await codeOf(() => ioc.Resolve(PerRequest)), 'IOC_SCOPE_REQUIRED');

    // A default yields instead of colliding.
    ioc.RegisterValue($Url, 'default', { Default: true });

    assertEquals(await ioc.Resolve($Url), 'a');
  });

  await t.step('Override needs a Testing container, and its scopes inherit that', async () => {
    const $Now = IoCToken<number>('CodesNow');

    const sealed = new IoCContainer().RegisterValue($Now, 1);

    assertThrows(() => sealed.Override($Now, 0), IoCSealedError, 'Testing: true');
    assertThrows(() => sealed.CreateScope().Override($Now, 0), IoCSealedError);

    const testing = new IoCContainer({ Testing: true }).RegisterValue($Now, 1);
    const scope = testing.CreateScope();

    const restore = scope.Override($Now, 0);

    assertEquals(await scope.Resolve($Now), 0);
    assertEquals(await testing.Resolve($Now), 1);

    restore();

    assertEquals(await scope.Resolve($Now), 1);
  });

  await t.step('scopes inherit their parent options', async () => {
    const $Hangs = IoCToken<number>('CodesScopeHangs');

    const root = new IoCContainer({ Levels: ['tenant'], PendingTimeoutMs: 10 });

    root.RegisterFactory($Hangs, () => new Promise<number>(() => {}), { Lifetime: 'scoped' });

    const tenant = root.CreateScope({ Level: 'tenant' });

    assertEquals(tenant.Describe().Level, 'tenant');
    assertThrows(() => tenant.CreateScope({ Level: 'request' }), IoCLevelError);
    assertEquals(await codeOf(() => tenant.Resolve($Hangs)), 'IOC_RESOLVE_TIMEOUT');
  });

  await t.step('invalid options are rejected', () => {
    for (
      const options of [
        { Levels: ['tenant', 'tenant'] },
        { Levels: [''] },
        { PendingTimeoutMs: -1 },
        { PendingTimeoutMs: Number.NaN },
        { PendingTimeoutMs: Infinity },
      ]
    ) {
      const err = assertThrows(() => new IoCContainer(options), IoCRegistrationError);

      assertEquals(err.code, 'IOC_INVALID_REGISTRATION');
    }

    // 0 turns the timeout off.
    new IoCContainer({ PendingTimeoutMs: 0 });
  });
});
