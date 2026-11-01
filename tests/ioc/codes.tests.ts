// Every error code has a producer, and isIoCError recognizes each one, including the
// AggregateError-based ones.
import {
  IoCActivationError,
  IoCCircularDependencyError,
  IoCContainerDisposedError,
  IoCDisposeError,
  IoCDuplicateRegistrationError,
  type IoCErrorCode,
  IoCModuleCycleError,
  IoCNotIsolatableError,
  IoCRegistrationError,
  IoCResolveTimeoutError,
  IoCScopeRequiredError,
  IoCServiceNotFoundError,
  IoCStartError,
  IoCValidationError,
  isIoCError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import type { IoCModule } from '../../src/ioc/IoCModule.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals } from '../test.deps.ts';

const $Missing = IoCToken<string>('CodesMissing');

class NeedsArgs {
  constructor(public x: number) {}
}

const failing = (message: string) => () => {
  throw new Error(message);
};

/** One way to make the container produce each code. */
const producers: Record<IoCErrorCode, () => unknown> = {
  IOC_SERVICE_NOT_FOUND: () => new IoCContainer().Resolve($Missing),
  IOC_CONTAINER_DISPOSED: async () => {
    const ioc = new IoCContainer();

    await ioc.Dispose();

    return ioc.Resolve($Missing);
  },
  IOC_CIRCULAR_DEPENDENCY: () =>
    new IoCContainer().RegisterFactory($Missing, (c) => c.Resolve($Missing)).Resolve($Missing),
  IOC_VALIDATION_FAILED: () => new IoCContainer().RegisterClass(NeedsArgs).Validate(),
  IOC_ACTIVATION_FAILED: () =>
    new IoCContainer().RegisterFactory($Missing, failing('nope')).Activate(),
  IOC_DISPOSE_FAILED: async () => {
    const ioc = new IoCContainer().RegisterFactory($Missing, () => 'x', {
      Dispose: failing('cannot close'),
    });

    await ioc.Resolve($Missing);

    return ioc.Dispose();
  },
  IOC_INVALID_REGISTRATION: () => new IoCContainer().RegisterClass((() => 1) as never),
  IOC_INVALID_KEY: () => new IoCContainer().Has('Db' as never),
  IOC_SCOPE_REQUIRED: () =>
    new IoCContainer().RegisterClass(NeedsArgs, { Lifetime: 'scoped', Deps: [IoCToken('X')] })
      .Resolve(NeedsArgs),
  IOC_DUPLICATE_REGISTRATION: () =>
    new IoCContainer().RegisterValue($Missing, 'a').RegisterValue($Missing, 'b'),
  IOC_START_FAILED: () =>
    new IoCContainer().Use({ Name: 'Broken', Register: () => {}, OnStart: failing('down') })
      .Start(),
  IOC_MODULE_CYCLE: () => {
    const A: IoCModule = { Name: 'A', Register: () => {} };
    const B: IoCModule = { Name: 'B', Requires: [A], Register: () => {} };

    (A as { Requires?: IoCModule[] }).Requires = [B];

    return new IoCContainer().Use(A);
  },
  IOC_RESOLVE_TIMEOUT: () =>
    new IoCContainer({ PendingTimeoutMs: 5 })
      .RegisterFactory($Missing, () => new Promise<string>(() => {}))
      .Resolve($Missing),
  IOC_NOT_ISOLATABLE: () =>
    new IoCContainer().RegisterValue($Missing, 'x').CreateScope().Isolate($Missing),
};

const codeOf = async (produce: () => unknown): Promise<string | undefined> => {
  try {
    await produce();
  } catch (err) {
    return (err as { code?: string }).code;
  }

  return undefined;
};

Deno.test('Error codes', async (t) => {
  for (const [code, produce] of Object.entries(producers)) {
    await t.step(`${code} is produced by the container`, async () => {
      assertEquals(await codeOf(produce), code);
    });
  }

  await t.step('isIoCError recognizes every error class, by code or in general', () => {
    const errors: [unknown, IoCErrorCode][] = [
      [new IoCServiceNotFoundError('X', '$default'), 'IOC_SERVICE_NOT_FOUND'],
      [new IoCContainerDisposedError(), 'IOC_CONTAINER_DISPOSED'],
      [new IoCCircularDependencyError(['A', 'A']), 'IOC_CIRCULAR_DEPENDENCY'],
      [new IoCValidationError(['x']), 'IOC_VALIDATION_FAILED'],
      [new IoCActivationError([], ['X']), 'IOC_ACTIVATION_FAILED'],
      [new IoCDisposeError([]), 'IOC_DISPOSE_FAILED'],
      [new IoCRegistrationError('x'), 'IOC_INVALID_REGISTRATION'],
      [new IoCScopeRequiredError('X'), 'IOC_SCOPE_REQUIRED'],
      [new IoCDuplicateRegistrationError('X'), 'IOC_DUPLICATE_REGISTRATION'],
      [new IoCStartError('M', new Error('x')), 'IOC_START_FAILED'],
      [new IoCModuleCycleError(['A', 'A']), 'IOC_MODULE_CYCLE'],
      [new IoCResolveTimeoutError('X', 1), 'IOC_RESOLVE_TIMEOUT'],
      [new IoCNotIsolatableError('X', 'why'), 'IOC_NOT_ISOLATABLE'],
    ];

    for (const [err, code] of errors) {
      assert(isIoCError(err), code);
      assert(isIoCError(err, code), code);
      assert(
        !isIoCError(err, code === 'IOC_START_FAILED' ? 'IOC_MODULE_CYCLE' : 'IOC_START_FAILED'),
      );
    }

    assert(!isIoCError(new Error('plain')));
    assert(!isIoCError({ code: 'ENOENT' }));
    assert(!isIoCError(null));
  });
});
