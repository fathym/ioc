/**
 * Small, async-first, decorator-free dependency injection for Deno, built for large applications.
 *
 * Register services once, resolve them anywhere, and let the container handle creation order,
 * async startup, per-request scopes and cleanup. No decorators, no `reflect-metadata`.
 *
 * - **Safe by default:** `new IoCContainer()` is strict (a second registration of the same key
 *   throws unless it says `Replace: true`), lazy (nothing is built until it is needed or
 *   `Start()` runs), and fails anything still pending after 30 seconds instead of hanging.
 * - **Keys are references:** an {@link IoCToken} is a unique key, and a class key is the class
 *   itself. Share a service by exporting its token; keep it private by not exporting it.
 * - **Sealed, typed modules:** only the module that registered a service can replace it, unless
 *   it registered it with `Default: true`. {@link DefineModule} types a module's needs and what it
 *   provides, and `Use()` on a {@link IoCContainer.Typed typed container} checks them.
 * - **Lifecycle at scale:** {@link IoCContainer.Start} validates, builds every singleton and
 *   starts modules by layer; a failed start cleans up and can be retried; `Dispose()` (or
 *   `await using`) stops modules, then disposes scopes and instances in reverse.
 * - **Scopes and levels:** {@link IoCContainer.CreateScope} per request or tenant, with declared
 *   `Levels`; {@link IoCContainer.Validate} reports missing, cyclic and captive dependencies.
 * - **Observable:** errors carry stable codes and the resolution path; `OnEvent` reports timings
 *   and warnings; {@link IoCContainer.Describe} shows the whole graph.
 *
 * Full documentation (tutorial, guides, error catalog):
 * https://github.com/fathym/ioc/blob/main/docs/README.md
 *
 * @example Quick start
 * ```ts
 * import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';
 *
 * interface Logger {
 *   log(message: string): void;
 * }
 *
 * // Exported, so other packages can resolve it. A token you don't export stays private.
 * export const $Logger = IoCToken<Logger, 'Logger'>('Logger');
 *
 * class Config {
 *   public url = 'kv://local';
 * }
 *
 * class Repo {
 *   constructor(public config: Config, public logger: Logger) {}
 * }
 *
 * // A module owns its registrations; Default: true lets the app replace the logger.
 * const Data = DefineModule({
 *   Name: 'Data',
 *   Register: (ioc) =>
 *     ioc
 *       .RegisterClass(Config)
 *       .RegisterValue($Logger, { log: (m) => console.log(m) }, { Default: true })
 *       .RegisterClass(Repo, { Deps: [Config, $Logger] }), // checked against Repo's constructor
 * });
 *
 * await using ioc = new IoCContainer().Typed().Use(Data);
 *
 * await ioc.Start(); // validates the wiring and builds every singleton
 *
 * const repo = await ioc.Resolve(Repo); // typed as Repo
 *
 * repo.logger.log(`Connected to ${repo.config.url}`);
 * ```
 *
 * @module
 */
export * from './src/.exports.ts';
