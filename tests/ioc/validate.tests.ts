// Validate(): missing, cycle, captive and arguments problems, from declared Deps only, without
// building anything.
import { IoCValidationError } from '../../src/ioc/errors.ts';
import { IoCContainer } from '../../src/ioc/ioc.ts';
import { IoCToken } from '../../src/ioc/IoCToken.ts';
import { assertEquals, assertThrows } from '../test.deps.ts';

const $Url = IoCToken<string>('ValUrl');

class Repo {
  constructor(public url: string) {}
}

const kinds = (ioc: IoCContainer) => ioc.Validate({ Throw: false }).map((i) => i.Kind);

Deno.test('Validate - problems', async (t) => {
  await t.step('a sound container has none', () => {
    const ioc = new IoCContainer()
      .RegisterValue($Url, 'kv://')
      .RegisterClass(Repo, { Deps: [$Url] });

    assertEquals(ioc.Validate(), []);
  });

  await t.step('missing: a declared dependency nobody registers', () => {
    const issues = new IoCContainer().RegisterClass(Repo, { Deps: [[$Url, 'replica']] }).Validate({
      Throw: false,
    });

    assertEquals(issues, [{
      Kind: 'missing',
      Service: 'Repo',
      Message: 'Repo depends on ValUrl[replica], which is not registered.',
    }]);
  });

  await t.step('an expected key counts as registered', () => {
    const ioc = new IoCContainer().Expect($Url).RegisterClass(Repo, { Deps: [$Url] });

    assertEquals(ioc.Validate(), []);
  });

  await t.step('cycle: reported once, however many services are in it', () => {
    const $A = IoCToken<unknown>('ValA');
    const $B = IoCToken<unknown>('ValB');
    const $C = IoCToken<unknown>('ValC');

    const issues = new IoCContainer()
      .RegisterFactory($A, (_c, b) => b, { Deps: [$B] })
      .RegisterFactory($B, (_c, c) => c, { Deps: [$C] })
      .RegisterFactory($C, (_c, a) => a, { Deps: [$A] })
      .Validate({ Throw: false });

    assertEquals(issues.map((i) => [i.Kind, i.Message]), [
      ['cycle', 'Circular dependency: ValA -> ValB -> ValC -> ValA.'],
    ]);
  });

  await t.step(
    'captive: a singleton holding a scoped service, directly or through transients',
    () => {
      class Session {}

      class Helper {
        constructor(public s: Session) {}
      }

      class Direct {
        constructor(public s: Session) {}
      }

      class Indirect {
        constructor(public h: Helper) {}
      }

      const issues = new IoCContainer()
        .RegisterClass(Session, { Lifetime: 'scoped' })
        .RegisterClass(Helper, { Deps: [Session], Lifetime: 'transient' })
        .RegisterClass(Direct, { Deps: [Session] })
        .RegisterClass(Indirect, { Deps: [Helper] })
        .Validate({ Throw: false });

      assertEquals(issues.map((i) => i.Message), [
        'singleton Direct depends on scoped Session; it would keep one instance for its whole ' +
        'life. Make Direct scoped, or resolve Session where it is used, from the scope at hand.',
        'singleton Indirect depends on scoped Session (through Helper); it would keep one ' +
        'instance for its whole life. Make Indirect scoped, or resolve Session where it is used, ' +
        'from the scope at hand.',
      ]);
    },
  );

  await t.step('a scoped service may depend on scoped and singleton ones', () => {
    class Session {}

    class Handler {
      constructor(public s: Session, public url: string) {}
    }

    const ioc = new IoCContainer()
      .RegisterValue($Url, 'kv://')
      .RegisterClass(Session, { Lifetime: 'scoped' })
      .RegisterClass(Handler, { Deps: [Session, $Url], Lifetime: 'scoped' });

    assertEquals(ioc.Validate(), []);
  });

  await t.step('arguments: a class without Deps whose constructor takes parameters', () => {
    class Base {
      constructor(public x: number) {}
    }

    class Inherits extends Base {}

    class Defaulted {
      constructor(public x = 1) {}
    }

    const issues = new IoCContainer()
      .RegisterClass(Repo)
      .RegisterClass(Inherits)
      .RegisterClass(Defaulted)
      .Validate({ Throw: false });

    assertEquals(issues.map((i) => i.Message), [
      'Repo is constructed without arguments, but its constructor declares 1 parameter(s); ' +
      'register it with Deps or with a factory.',
      'Inherits is constructed without arguments, but its constructor declares 1 parameter(s); ' +
      'register it with Deps or with a factory.',
    ]);
  });

  await t.step('factories without Deps are not checked', () => {
    const ioc = new IoCContainer().RegisterFactory(
      Repo,
      async (c) => new Repo(await c.Resolve($Url)),
    );

    assertEquals(ioc.Validate(), []);
  });
});

Deno.test('Validate - behavior', async (t) => {
  await t.step('throws one error listing every problem', () => {
    class Lonely {
      constructor(public x: number) {}
    }

    const err = assertThrows(
      () =>
        new IoCContainer().RegisterClass(Repo, { Deps: [$Url] }).RegisterClass(Lonely).Validate(),
      IoCValidationError,
    );

    assertEquals(err.Issues.map((i) => i.Kind), ['missing', 'arguments']);
    assertEquals(err.Problems.length, 2);
    assertEquals(
      err.message,
      'IoC validation failed:\n' +
        '  - Repo depends on ValUrl, which is not registered.\n' +
        '  - Lonely is constructed without arguments, but its constructor declares 1 ' +
        'parameter(s); register it with Deps or with a factory.',
    );
  });

  await t.step('a scope validates against its parents, and its own registrations win', () => {
    const root = new IoCContainer().RegisterClass(Repo, { Deps: [$Url] });

    assertEquals(kinds(root), ['missing']);

    const scope = root.CreateScope().RegisterValue($Url, 'kv://scope');

    assertEquals(kinds(scope), []);
  });

  await t.step('never builds anything', () => {
    let built = 0;

    const ioc = new IoCContainer()
      .RegisterFactory($Url, () => (built++, 'x'))
      .RegisterClass(Repo, { Deps: [$Url] });

    ioc.Validate();

    assertEquals(built, 0);
  });
});
