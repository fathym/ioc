# @fathym/ioc

### Dependency injection for modern TypeScript. No decorators. No metadata. Async from the ground up.

[![JSR](https://jsr.io/badges/@fathym/ioc)](https://jsr.io/@fathym/ioc)
[![JSR Score](https://jsr.io/badges/@fathym/ioc/score)](https://jsr.io/@fathym/ioc/score)
[![Build](https://github.com/fathym/ioc/actions/workflows/build.yml/badge.svg)](https://github.com/fathym/ioc/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/fathym/ioc/blob/main/LICENSE)

Most TypeScript DI containers were built for a world of `experimentalDecorators` and
`reflect-metadata`. They break under esbuild, Vite and Vitest, they resolve synchronously while
your database connects asynchronously, and they tell you about a missing dependency when the first
request hits it.

**@fathym/ioc is built for how TypeScript apps are written today.** Plain classes. Typed keys.
Async factories that just work. Wiring mistakes caught by the compiler, and the rest caught at
startup. Clean shutdown when you're done. It runs on Deno, Node.js and Bun, in about 6 KB gzipped,
with zero dependencies.

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Mailer {
  send(to: string, body: string): Promise<void>;
}

class Db {
  static async connect(url: string) {
    return new Db(url); // open your real connection pool here
  }

  constructor(public url: string) {}

  async [Symbol.asyncDispose]() {
    console.log('db closed');
  }
}

class Signup {
  constructor(private db: Db, private mailer: Mailer) {}

  async register(email: string) {
    await this.mailer.send(email, `Welcome! (saved to ${this.db.url})`);
  }
}

const $Mailer = IoCToken<Mailer>('app/Mailer');

{
  await using ioc = new IoCContainer()
    .RegisterFactory(Db, () => Db.connect('postgres://localhost/app')) // async, built once
    .RegisterValue($Mailer, { send: async (to, body) => console.log(`to ${to}: ${body}`) })
    .RegisterClass(Signup, { Deps: [Db, $Mailer] }); // checked against the constructor

  ioc.Validate(); // every wiring mistake, reported before anything runs

  const signup = await ioc.Resolve(Signup); // typed as Signup

  await signup.register('ada@example.com'); // to ada@example.com: Welcome! (saved to …)
} // db closed: whatever the container built is disposed, in reverse order
```

## Why teams pick it

- **🧩 No decorators, no metadata, no build step.** Your classes stay plain TypeScript. Nothing
  depends on `emitDecoratorMetadata`, so it works the same under esbuild, Vite, tsx, Vitest, Deno,
  Node.js and Bun.
- **🛡️ Mistakes caught by the compiler.** `Deps` is checked against your constructor, in order
  and by type. Turn on `Typed()` and using a service before it's registered won't compile.
- **🔍 The rest caught at startup.** `Validate()` lists every missing dependency, cycle and
  lifetime mistake in one go, without building anything. Put it in one test and wiring bugs never
  reach production.
- **⚡ Async is first-class.** Factories can be `async`. Concurrent requests share one build, and a
  connection that fails is retried on the next resolve instead of being cached as broken.
- **🧹 Clean shutdown, built in.** One scope per request with `await using`. Everything the
  container built is disposed in reverse order. Modules start in dependency order and stop in
  reverse, so your server drains before your database closes.
- **🧪 Easy to test.** `Override()` swaps any service for a fake and hands you a restore
  function. Test against the real wiring, not a hand-built copy of it.
- **📖 Errors that explain themselves.** Every error has a stable code and an
  [entry in the catalog](https://github.com/fathym/ioc/blob/main/docs/reference/errors.md) with
  the cause and the fix.

## See it in action

**A scope per request,** cleaned up when the request ends:

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

const $Request = IoCToken<{ path: string }>('app/Request');

class RequestContext {
  public id = crypto.randomUUID().slice(0, 8);
}

class Handler {
  constructor(private req: { path: string }, private ctx: RequestContext) {}

  handle() {
    return `${this.ctx.id} handled ${this.req.path}`;
  }
}

const app = new IoCContainer()
  .RegisterClass(RequestContext, { Lifetime: 'scoped' }) // one per request
  .RegisterClass(Handler, { Deps: [$Request, RequestContext], Lifetime: 'transient' });

for (const path of ['/notes', '/users']) {
  await using scope = app.CreateScope().RegisterValue($Request, { path });

  console.log((await scope.Resolve(Handler)).handle()); // 3f9c1a2b handled /notes …
}
```

**Modules with a lifecycle,** started in order and stopped in reverse:

```ts
import { DefineModule, IoCContainer } from '@fathym/ioc';

const Database = DefineModule({
  Name: 'Database',
  Register: (ioc) => ioc,
  OnStart: () => console.log('database connected'),
  OnStop: () => console.log('database closed'),
});

const Api = DefineModule({
  Name: 'Api',
  Requires: [Database], // started after Database, stopped before it
  Register: (ioc) => ioc,
  OnStart: () => console.log('api listening'),
  OnStop: () => console.log('api drained'),
});

{
  await using app = new IoCContainer().Use(Api);

  await app.Start(); // database connected, api listening
} // api drained, database closed
```

## How it compares

|                                          | @fathym/ioc | InversifyJS | tsyringe | awilix  | NestJS |
| ---------------------------------------- | :---------: | :---------: | :------: | :-----: | :----: |
| No decorators or `reflect-metadata`      |      ✓      |      ✗      |    ✗     |    ✓    |   ✗    |
| Constructor deps checked at compile time |      ✓      |      ✗      |    ✗     |    ✗    |   ✗    |
| Async factories                          |      ✓      |      ✓      |    ✗     |    ✗    |   ✓    |
| Startup validation of the whole wiring   |      ✓      |      ✗      |    ✗     |    ~    |   ✓    |
| Modules with start/stop lifecycle        |      ✓      |      ~      |    ✗     |    ✗    |   ✓    |
| Disposal of what it built                |      ✓      |      ~      |    ~     |    ✓    |   ✓    |
| Standalone library, not a framework      |      ✓      |      ✓      |    ✓     |    ✓    |   ✗    |
| Synchronous resolve                      |      ✗      |      ✓      |    ✓     |    ✓    |   ✓    |
| Minified + gzipped                       | **6.1 KB**  |   24.7 KB   | 11.0 KB  | 30.1 KB | 141 KB |
| Runtime dependencies                     |    **0**    |    6 + 1    |  1 + 1   |   18    | 18 + 2 |

✓ built in · ~ partial · ✗ not available. Features are based on each project's documentation,
October 2026. Sizes are each whole library bundled with its required polyfill and measured with
`deno task size --compare` (InversifyJS 8.2, tsyringe 4.10, awilix 13.0, NestJS 12.3 core and
common). Dependencies count indirect ones; "+ 1" is `reflect-metadata`, and NestJS's "+ 2" adds
rxjs. awilix's browser build leaves out file scanning and is 3.6 KB.

Need several implementations of one interface, such as a chain of handlers or one cache per
region? Register each under a
[name](https://github.com/fathym/ioc/blob/main/docs/reference/api.md#resolveallkey) and
collect them with `ResolveAll`. A whole folder of modules registers with one call, too: see
[registering many modules](https://github.com/fathym/ioc/blob/main/docs/guides/registering-many-modules.md).

**Pick something else if** you need synchronous resolution everywhere, auto-registration by
scanning files and naming conventions (awilix does this well), property injection or bindings
chosen by tags and injection target (InversifyJS), or you're inside a framework with its own DI,
such as NestJS or Angular.

## Install

```sh
deno add jsr:@fathym/ioc     # Deno
npx jsr add @fathym/ioc      # Node.js 20+
bunx jsr add @fathym/ioc     # Bun
```

TypeScript 5.4 or later. See the
[requirements](https://github.com/fathym/ioc/blob/main/docs/getting-started/installation.md#requirements).

## Learn it in 15 minutes

| Start here                                                                                | What you get                                         |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [Getting started](https://github.com/fathym/ioc/blob/main/docs/getting-started/README.md) | Five short steps, from a first container to tests    |
| [API reference](https://github.com/fathym/ioc/blob/main/docs/reference/api.md)            | Every method and option, each with an example        |
| [Error catalog](https://github.com/fathym/ioc/blob/main/docs/reference/errors.md)         | Every error message: what it means and how to fix it |
| [Examples](https://github.com/fathym/ioc/blob/main/examples/README.md)                    | Small programs you can run and copy, an HTTP app too |
| [Upgrading from 0.x](https://github.com/fathym/ioc/blob/main/docs/migration/from-0.x.md)  | Every old call next to its replacement               |

Every code example in the docs is type-checked and run in CI, so what you read is what works. The
generated API docs are on [JSR](https://jsr.io/@fathym/ioc/doc), and AI tools can start from
[`llms.txt`](https://github.com/fathym/ioc/blob/main/llms.txt).

## Built to be depended on

- **Semantic versioning**, with breaking changes only in major releases, each with a migration
  guide. The [versioning policy](https://github.com/fathym/ioc/blob/main/docs/policy.md) spells
  out deprecations, supported runtimes and releases.
- **Tested on every runtime it supports:** the full suite on Deno, and the published build on
  Node.js 20, 22 and 24 and Bun, type-checked with TypeScript 5.4 and the latest.
- **Every change** is in the [changelog](https://github.com/fathym/ioc/blob/main/CHANGELOG.md).

Built and maintained by [Fathym](https://github.com/fathym), and used across Fathym's own
platform, from the CLI to the runtime.

## Contributing

Issues and pull requests are welcome. See
[CONTRIBUTING](https://github.com/fathym/ioc/blob/main/CONTRIBUTING.md) for setup, tests and
documentation conventions. Please report security issues privately as described in
[SECURITY](https://github.com/fathym/ioc/blob/main/SECURITY.md), and follow the
[Code of Conduct](https://github.com/fathym/ioc/blob/main/CODE_OF_CONDUCT.md).

## License

[MIT](https://github.com/fathym/ioc/blob/main/LICENSE) © Fathym
