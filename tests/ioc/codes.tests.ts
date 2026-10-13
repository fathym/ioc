// Error codes and container options.
import {
  IoCActivationError,
  IoCCircularDependencyError,
  IoCContainerDisposedError,
  IoCDisposeError,
  type IoCErrorCode,
  IoCRegistrationError,
  IoCServiceNotFoundError,
  IoCValidationError,
  isIoCError,
} from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assert, assertEquals, assertInstanceOf, assertRejects } from '../test.deps.ts';

async function codeOf(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }

  return undefined;
}

Deno.test('Error codes', async (t) => {
  await t.step('every container error carries a stable code', async () => {
    const ioc = new IoCContainer();

    assertEquals(
      await codeOf(() => ioc.Resolve(IoCToken('CodesMissing'))),
      'IOC_SERVICE_NOT_FOUND',
    );

    assertEquals(
      await codeOf(() => ioc.RegisterFactory(IoCToken('CodesBad'), 'x' as never)),
      'IOC_INVALID_REGISTRATION',
    );

    assertEquals(
      await codeOf(() => ioc.RegisterClass((() => ({})) as never)),
      'IOC_INVALID_REGISTRATION',
    );

    const $A = IoCToken<number>('CodesA');
    const $B = IoCToken<number>('CodesB');

    ioc.RegisterFactory($A, async (c) => await c.Resolve($B), { Lazy: true });
    ioc.RegisterFactory($B, async (c) => await c.Resolve($A), { Lazy: true });

    assertEquals(await codeOf(() => ioc.Resolve($A)), 'IOC_CIRCULAR_DEPENDENCY');

    class NeedsArgs {
      constructor(public x: number) {}
    }

    const invalid = new IoCContainer().RegisterClass(NeedsArgs, { Lazy: true });

    assertEquals(await codeOf(() => invalid.Validate()), 'IOC_VALIDATION_FAILED');

    await ioc.Dispose();

    assertEquals(await codeOf(() => ioc.Resolve($A)), 'IOC_CONTAINER_DISPOSED');
  });

  await t.step('activation and dispose failures are AggregateErrors with codes', async () => {
    const ioc = new IoCContainer();

    ioc.RegisterFactory(IoCToken('CodesBoom'), () => Promise.reject(new Error('boom')), {
      Lazy: true,
    });

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

    const disposing = await assertRejects(() => owner.Dispose(), IoCDisposeError);

    assertInstanceOf(disposing, AggregateError);
    assertEquals(disposing.code, 'IOC_DISPOSE_FAILED');
  });

  await t.step('isIoCError checks the code, not the class', () => {
    const codes: IoCErrorCode[] = ['IOC_SERVICE_NOT_FOUND', 'IOC_CIRCULAR_DEPENDENCY'];

    assert(isIoCError(new IoCServiceNotFoundError(Symbol.for('X'), '$default')));
    assert(isIoCError(new IoCCircularDependencyError(['A', 'A']), codes[1]));
    assert(!isIoCError(new IoCContainerDisposedError(), codes[0]));
    assert(!isIoCError(new Error('plain')));
    assert(!isIoCError(null));

    // An error from another copy of the library is recognized by its code alone.
    assert(isIoCError(Object.assign(new Error('foreign'), { code: 'IOC_SERVICE_NOT_FOUND' })));
    assert(!isIoCError(Object.assign(new Error('other'), { code: 'ENOENT' })));
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
  await t.step('no options behaves as before: singletons are eager', () => {
    let built = 0;

    class Eager {
      constructor() {
        built++;
      }
    }

    new IoCContainer().RegisterClass(Eager);

    assertEquals(built, 1);
  });

  await t.step('LazyByDefault defers singletons unless Lazy: false', async () => {
    let built = 0;

    class Deferred {
      constructor() {
        built++;
      }
    }

    class Forced {
      constructor() {
        built += 10;
      }
    }

    const ioc = new IoCContainer({ LazyByDefault: true })
      .RegisterClass(Deferred)
      .RegisterClass(Forced, { Lazy: false });

    assertEquals(built, 10);

    await ioc.Resolve(Deferred);

    assertEquals(built, 11);
  });

  await t.step('Create() turns on Strict and LazyByDefault', async () => {
    let built = 0;

    class Later {
      constructor() {
        built++;
      }
    }

    const ioc = IoCContainer.Create().RegisterClass(Later);

    assertEquals(built, 0);

    await ioc.Activate();

    assertEquals(built, 1);
  });

  await t.step('scopes inherit their parent options', () => {
    let built = 0;

    class InScope {
      constructor() {
        built++;
      }
    }

    const scope = new IoCContainer({ LazyByDefault: true }).CreateScope();

    scope.RegisterClass(InScope);

    assertEquals(built, 0);
  });
});
