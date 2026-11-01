/**
 * The conventions AI coding agents follow when they write or change code that uses
 * `@fathym/ioc`. The same text goes into every agent kit file (Claude Code skill, Cursor rule,
 * `AGENTS.md`, Copilot instructions); its TypeScript example is type-checked and run in CI.
 *
 * @module
 */

/** Where agents find the full documentation and the error catalog. */
export const IOC_DOCS_LINKS = {
  /** The index of the docs, for AI agents (https://llmstxt.org). */
  LlmsTxt: 'https://raw.githubusercontent.com/fathym/ioc/main/llms.txt',

  /** Every docs page and example program in one file. */
  LlmsFullTxt: 'https://raw.githubusercontent.com/fathym/ioc/main/llms-full.txt',

  /** Every error code and message, with its cause and fix. */
  Errors: 'https://github.com/fathym/ioc/blob/main/docs/reference/errors.md',
} as const;

/** The agent rules for `@fathym/ioc`, as Markdown. */
export const IOC_AGENT_RULES: string = `# Working with @fathym/ioc

\`@fathym/ioc\` is a dependency injection container for TypeScript: explicit registrations, typed
keys, async factories, scopes with disposal, and \`Validate()\` to check the wiring. No decorators
and no \`reflect-metadata\`. Full docs for agents: ${IOC_DOCS_LINKS.LlmsFullTxt}.

## Wiring conventions

1. **One composition root.** Build the container in one place (for example \`src/container.ts\`)
   and export it, or a function that builds it. Register capabilities (clients, repositories,
   services, tools), not every function or value object.
2. **Interfaces get typed tokens.** \`const $Mailer = IoCToken<Mailer, 'app/Mailer'>('app/Mailer')\`.
   Token names are global (\`Symbol.for\`), so prefix them with the app or package name. Classes are
   their own keys.
3. **Every class with constructor parameters gets \`Deps\`,** in constructor order:
   \`RegisterClass(Repo, { Deps: [Db, $Logger] })\`. The compiler checks them against the
   constructor; when you change a constructor, update its \`Deps\`.
4. **Async setup goes in a factory:** \`RegisterFactory(Db, () => Db.connect(url))\`. Give factories
   \`Deps\` too, so \`Validate()\` can see them. Never resolve services inside a constructor.
5. **Lifetimes:** singleton (the default) for shared clients; \`'scoped'\` for per-request or
   per-session state; \`'transient'\` for cheap, stateless objects.
6. **Per request or session:** \`await using scope = app.CreateScope();\` then register the request's
   values on the scope (\`scope.RegisterValue($Request, req)\`) and resolve from it. Scoped services
   can't be resolved from the root container.
7. **Several implementations of one interface:** register each with a \`Name\` and collect them with
   \`ResolveAll\` or \`ResolveNamed\`, or pick one in \`Deps\` with \`[$Key, 'name']\`. Library defaults use
   \`Default: true\`; an app replaces a registration on purpose with \`Replace: true\`.
8. **Modules** group a capability: \`DefineModule({ Name, Requires, Register, OnStart, OnStop })\`,
   added with \`app.Use(...)\` and started with \`await app.Start()\` (which validates first).
9. **Tests** swap services with \`const restore = app.Override($Key, fake)\` and call \`restore()\` after.
10. **Shutdown:** \`await using\` the container, or \`await app.Dispose()\`. It stops modules and
    disposes what it built, in reverse.

## The fix loop

1. **Type errors on \`Deps\`** mean the list doesn't match the constructor (order, count or type).
   Fix the \`Deps\`, not the types.
2. **After changing the wiring, run \`Validate()\`** (keep a test that builds the container and
   calls it). Each problem comes with a \`Fix:\` line (\`Hint\` on the issue); apply it.
3. **Runtime errors have a stable \`code\` and a \`DocsUrl\`** pointing at the cause and the fix in
   ${IOC_DOCS_LINKS.Errors}. Match on \`code\` (\`isIoCError(err, 'IOC_SERVICE_NOT_FOUND')\`), never
   on the message.

## Don't

- Don't use decorators, \`reflect-metadata\` or string keys.
- Don't register every function or value object; inject capabilities.
- Don't resolve scoped services from the root container, or keep a scope beyond its request.
- Don't call \`Resolve\` in constructors; declare \`Deps\` instead.
- Don't catch and ignore \`Validate()\` problems; fix them.

## Example

\`\`\`ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Mailer {
  send(to: string, body: string): Promise<void>;
}

const $Mailer = IoCToken<Mailer, 'app/Mailer'>('app/Mailer');

class Db {
  static async connect(url: string) {
    return new Db(url);
  }

  constructor(public url: string) {}

  async [Symbol.asyncDispose]() {}
}

class Signup {
  constructor(private db: Db, private mailer: Mailer) {}

  async register(email: string) {
    await this.mailer.send(email, \`Welcome! (saved to \${this.db.url})\`);
  }
}

export function buildContainer() {
  return new IoCContainer()
    .RegisterFactory(Db, () => Db.connect('postgres://localhost/app'))
    .RegisterValue($Mailer, { send: async () => {} })
    .RegisterClass(Signup, { Deps: [Db, $Mailer] });
}

await using app = buildContainer();

app.Validate(); // throws IoCValidationError, with a Fix: line per problem

await (await app.Resolve(Signup)).register('ada@example.com');
\`\`\`
`;
