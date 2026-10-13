/**
 * Small, async-first, decorator-free dependency injection for Deno.
 *
 * Register services once, resolve them anywhere, and let the container handle creation order,
 * async startup, per-request scopes and cleanup. No decorators, no `reflect-metadata`.
 *
 * - **Async-first:** async factories, shared in-flight creation, failures retried, not cached.
 * - **Typed:** {@link IoCToken typed tokens}, abstract classes as keys, and constructor
 *   dependencies (`Deps`) checked against the constructor and, on a
 *   {@link IoCContainer.Typed typed container}, against what is already registered.
 * - **Scopes and disposal:** {@link IoCContainer.CreateScope} with `await using`, disposed in
 *   reverse creation order.
 * - **Fails early:** errors name the resolution path and carry stable codes, cycles throw, and
 *   {@link IoCContainer.Validate} / {@link IoCContainer.Start} check wiring at startup.
 * - **For frameworks and plugin hosts:** {@link IoCModule modules} with lifecycle, `Default`
 *   registrations, scope levels, {@link IoCContainer.Isolate}, and {@link IoCContainer.Describe}.
 *
 * Full documentation (tutorial, guides, error catalog):
 * https://github.com/fathym/ioc/blob/main/docs/README.md
 *
 * @example Quick start
 * ```ts
 * import { IoCContainer, IoCToken } from '@fathym/ioc';
 *
 * interface Logger {
 *   log(message: string): void;
 * }
 *
 * const $Logger = IoCToken<Logger, 'Logger'>('Logger');
 *
 * class Config {
 *   public url = 'kv://local';
 * }
 *
 * class Repo {
 *   constructor(public config: Config, public logger: Logger) {}
 * }
 *
 * const ioc = new IoCContainer()
 *   .Typed() // Deps may only name keys registered above them
 *   .RegisterClass(Config)
 *   .RegisterFactory($Logger, () => ({ log: (message) => console.log(message) }))
 *   .RegisterClass(Repo, { Deps: [Config, $Logger] });
 *
 * ioc.Validate();
 *
 * const repo = await ioc.Resolve(Repo);
 *
 * repo.logger.log(`Connected to ${repo.config.url}`);
 * ```
 *
 * @module
 */
export * from './src/.exports.ts';
