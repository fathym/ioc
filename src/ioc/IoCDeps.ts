import type { IoCDependency, IoCDependencyKey, IoCServiceOf } from './ioc.ts';

/**
 * A dependency that is injected as something derived from a registration rather than the
 * service itself: a function that resolves it later ({@link IoCLazy}), or every registration of
 * a key ({@link IoCAll}). Use it in `Deps` (of `RegisterClass` and `RegisterFactory`) and in
 * `ResolveRecord`.
 */
export interface IoCDerivedDependency<T> {
  /** How the dependency is derived. */
  readonly '@fathym/ioc/derived': 'lazy' | 'all';

  /** The wrapped key, or `[key, name]`. */
  readonly Dependency: unknown;

  /** Type-only: the injected value's type. Never present at runtime. */
  readonly '@fathym/ioc/type': T;
}

/** The value a dependency injects: the service, or what a derived dependency produces. */
export type IoCDependencyValue<D> = D extends IoCDerivedDependency<infer T> ? T
  : D extends readonly [infer K, string] ? IoCServiceOf<K>
  : IoCServiceOf<D>;

/** The values a list of dependencies injects, in order. */
export type IoCDependencyValues<TDeps extends readonly unknown[]> = {
  -readonly [I in keyof TDeps]: IoCDependencyValue<TDeps[I]>;
};

/**
 * Injects a function that resolves the dependency when called, instead of the service itself.
 * Use it for services needed only sometimes, for expensive ones, and to break a cycle between
 * two services that each need the other only after construction. `Validate()` still checks that
 * the dependency is registered, but doesn't count it in cycles.
 *
 * @example
 * ```ts
 * import { IoCContainer, IoCLazy, IoCToken } from '@fathym/ioc';
 *
 * interface Mailer {
 *   send(to: string): string;
 * }
 *
 * const $Mailer = IoCToken<Mailer, 'Mailer'>('Mailer');
 *
 * class Signup {
 *   constructor(private mailer: () => Promise<Mailer>) {}
 *
 *   async welcome(to: string) {
 *     return (await this.mailer()).send(to); // resolved on first use
 *   }
 * }
 *
 * const ioc = new IoCContainer()
 *   .RegisterFactory($Mailer, () => ({ send: (to) => `sent to ${to}` }), { Lazy: true })
 *   .RegisterClass(Signup, { Deps: [IoCLazy($Mailer)] });
 *
 * console.log(await (await ioc.Resolve(Signup)).welcome('ada@example.com'));
 * ```
 */
export function IoCLazy<const D extends IoCDependency<unknown>>(
  dependency: D,
): IoCDerivedDependency<() => Promise<IoCDependencyValue<D>>> {
  return {
    '@fathym/ioc/derived': 'lazy',
    Dependency: dependency,
  } as unknown as IoCDerivedDependency<
    () => Promise<IoCDependencyValue<D>>
  >;
}

/**
 * Injects every registration of a key (all names, nearest scope first), as an array. An empty
 * array when nothing is registered. Use it for plugin lists and resolver chains: register each
 * implementation under its own name and inject them all.
 *
 * @example
 * ```ts
 * import { IoCAll, IoCContainer, IoCToken } from '@fathym/ioc';
 *
 * interface Resolver {
 *   handles(path: string): boolean;
 * }
 *
 * const $Resolver = IoCToken<Resolver, 'Resolver'>('Resolver');
 *
 * class Router {
 *   constructor(public resolvers: Resolver[]) {}
 *
 *   route(path: string) {
 *     return this.resolvers.findIndex((r) => r.handles(path));
 *   }
 * }
 *
 * const ioc = new IoCContainer()
 *   .RegisterValue($Resolver, { handles: (p) => p.startsWith('/api') }, { Name: 'api' })
 *   .RegisterValue($Resolver, { handles: () => true }, { Name: 'fallback' })
 *   .RegisterClass(Router, { Deps: [IoCAll($Resolver)] });
 *
 * console.log((await ioc.Resolve(Router)).route('/home')); // 1
 * ```
 */
export function IoCAll<const K extends IoCDependencyKey<unknown>>(
  key: K,
): IoCDerivedDependency<IoCServiceOf<K>[]> {
  return { '@fathym/ioc/derived': 'all', Dependency: key } as unknown as IoCDerivedDependency<
    IoCServiceOf<K>[]
  >;
}
