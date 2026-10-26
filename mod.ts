/**
 * Small, async-first, decorator-free dependency injection for Deno, Node.js and Bun.
 *
 * Register services once, resolve them anywhere, and let the container handle creation order,
 * async setup, per-request scopes and cleanup. No decorators, no `reflect-metadata`.
 *
 * - **Typed keys:** an {@link IoCToken} is a typed name (`Symbol.for` underneath, so packages
 *   that use the same name share the key); a class key is the class itself.
 * - **Explicit registration:** `RegisterClass`, `RegisterFactory` and `RegisterValue`. Registering
 *   a key twice throws unless it says `Replace: true`; framework defaults use `Default: true`.
 * - **Scopes and cleanup:** {@link IoCContainer.CreateScope} per request or command; instances
 *   are disposed with the container (or scope) that built them, `await using` included.
 * - **Modules:** units of registrations with `OnStart`/`OnStop`, started in order by
 *   {@link IoCContainer.Start} and stopped in reverse by `Dispose()`. {@link DefineModule} types
 *   what a module needs and provides.
 * - **Checked wiring:** {@link IoCContainer.Validate} reports missing, cyclic and captive
 *   dependencies; errors carry stable codes.
 *
 * Full documentation: https://github.com/fathym/ioc/blob/main/docs/README.md
 *
 * @example Quick start
 * ```ts
 * import { IoCContainer, IoCToken } from '@fathym/ioc';
 *
 * interface Logger {
 *   log(message: string): void;
 * }
 *
 * export const $Logger = IoCToken<Logger, 'app/Logger'>('app/Logger');
 *
 * class Config {
 *   public url = 'kv://local';
 * }
 *
 * class Repo {
 *   constructor(public config: Config, public logger: Logger) {}
 * }
 *
 * await using ioc = new IoCContainer()
 *   .RegisterClass(Config)
 *   .RegisterValue($Logger, { log: (m) => console.log(m) })
 *   .RegisterClass(Repo, { Deps: [Config, $Logger] }); // checked against Repo's constructor
 *
 * ioc.Validate(); // the wiring is sound
 *
 * const repo = await ioc.Resolve(Repo); // typed as Repo
 *
 * repo.logger.log(`Connected to ${repo.config.url}`);
 * ```
 *
 * @module
 */
export * from './src/.exports.ts';
