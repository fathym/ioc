import type { IoCContainer, IoCDependencyKey, IoCExpected, IoCNoKeys } from './ioc.ts';

/**
 * A named unit of registrations with an optional lifecycle: the way a framework, a plugin or a
 * feature contributes services to a host container. Add modules with {@link IoCContainer.Use}.
 *
 * - `Register` adds the module's services. It runs once per container, after the modules it
 *   `Requires`.
 * - `OnStart` runs from {@link IoCContainer.Start}, one module at a time, after the modules it
 *   requires.
 * - `OnStop` runs from {@link IoCContainer.Dispose}, in the reverse order, before any instance is
 *   disposed, for modules that started.
 *
 * Each of them receives the container.
 *
 * Use {@link DefineModule} to get a typed module, whose `Register` is checked against what the
 * module needs and whose provided keys flow into a typed container.
 *
 * @example
 * ```ts
 * import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';
 *
 * interface Clock {
 *   now(): number;
 * }
 *
 * const $Clock = IoCToken<Clock, 'Clock'>('Clock');
 *
 * const ClockModule: IoCModule = {
 *   Name: 'Clock',
 *   Register: (ioc) => {
 *     ioc.RegisterValue($Clock, { now: () => Date.now() }, { Default: true });
 *   },
 * };
 *
 * await using ioc = new IoCContainer().Use(ClockModule);
 *
 * await ioc.Start();
 *
 * console.log((await ioc.Resolve($Clock)).now() > 0);
 * ```
 *
 * @typeParam TNeeds Type-only: the keys the module needs from elsewhere (see `DefineModule`).
 * @typeParam TProvides Type-only: the keys the module registers itself (see `DefineModule`). A module written by hand needs and provides nothing, as far as types go.
 */
export interface IoCModule<TNeeds = never, TProvides = never> {
  /** A unique, readable name, used in errors and `Describe()`. */
  readonly Name: string;

  /** Modules that must be registered (and started) before this one. */
  // deno-lint-ignore no-explicit-any
  readonly Requires?: readonly IoCModule<any, any>[];

  /**
   * Keys the module needs that someone else registers (the app, or a module it doesn't require).
   * Type-only: on a typed container, `Use()` doesn't compile until they are registered.
   */
  // deno-lint-ignore no-explicit-any
  readonly Needs?: readonly (IoCDependencyKey<any> | readonly [IoCDependencyKey<any>, string])[];

  /** Adds the module's registrations. Synchronous: async setup belongs in `OnStart` or factories. */
  // deno-lint-ignore no-explicit-any
  Register(ioc: IoCContainer<any>): unknown;

  /** Runs from `Start()`, after the modules it requires have started. */
  // deno-lint-ignore no-explicit-any
  OnStart?(ioc: IoCContainer<any>): unknown;

  /** Runs when the container is disposed, before its instances are, if the module started. */
  // deno-lint-ignore no-explicit-any
  OnStop?(ioc: IoCContainer<any>): unknown;

  /**
   * Type-only marker carrying what the module needs and provides; never present at runtime.
   *
   * @ignore
   */
  readonly '@fathym/ioc/module'?: IoCModuleTypes<TNeeds, TProvides>;
}

/**
 * The type-only marker of a module. Its parameter is compared both ways (a method signature), so
 * a typed module still fits wherever a plain `IoCModule` is expected.
 */
export type IoCModuleTypes<TNeeds, TProvides> = {
  marker(types: { needs: TNeeds; provides: TProvides }): void;
}['marker'];

/**
 * The keys a module itself registers (type-only). What the modules it requires register is theirs:
 * a module's type never grows with the depth of its requirements, so type-checking stays cheap.
 */
export type IoCModuleProvides<M> = M extends {
  readonly '@fathym/ioc/module'?: (types: { needs: infer _N; provides: infer P }) => void;
} ? P
  : never;

/**
 * The keys a module needs from elsewhere, including what the modules it requires need and don't
 * get from their own requirements (type-only).
 */
export type IoCModuleNeeds<M> = M extends {
  readonly '@fathym/ioc/module'?: (types: { needs: infer N; provides: infer _P }) => void;
} ? N
  : never;

/** The keys the listed modules register themselves (type-only). */
export type IoCModulesProvide<TModules> = TModules extends readonly (infer M)[]
  ? IoCModuleProvides<M>
  : never;

/** The keys needed by a list of modules (type-only). */
export type IoCModulesNeed<TModules> = TModules extends readonly (infer M)[] ? IoCModuleNeeds<M>
  : never;

/** The registry of a container, read from its type (type-only). */
export type IoCKeysOf<TContainer> = TContainer extends
  { readonly '@fathym/ioc/keys'?: (keys: infer K) => void } ? K : never;

/** The registry a typed module's `Register`, `OnStart` and `OnStop` see. */
export type IoCModuleKeys<TRequires, TNeeds extends readonly unknown[]> =
  | IoCNoKeys
  | IoCExpected<TNeeds>
  | IoCModulesProvide<TRequires>;

/** What {@link DefineModule} takes. */
export interface IoCModuleDefinition<
  // deno-lint-ignore no-explicit-any
  TRequires extends readonly IoCModule<any, any>[],
  TNeeds extends readonly unknown[],
  TResult,
> {
  /** A unique, readable name, used in errors and `Describe()`. */
  readonly Name: string;

  /**
   * Modules that must be registered (and started) before this one. What they register themselves
   * is typed in; to depend on a module further down, require it too (or list its keys in `Needs`).
   */
  readonly Requires?: TRequires;

  /** Keys the module needs that someone else registers; they are typed in too. */
  readonly Needs?: TNeeds;

  /**
   * Adds the module's registrations. Chain them and return the chain: what it returns is what the
   * module provides to a typed container.
   */
  Register(ioc: IoCContainer<IoCModuleKeys<TRequires, TNeeds>>): TResult;

  /** Runs from `Start()`, after the modules it requires have started. */
  OnStart?(ioc: IoCContainer<IoCModuleKeys<TRequires, TNeeds>>): unknown;

  /** Runs when the container is disposed, before its instances are, if the module started. */
  OnStop?(ioc: IoCContainer<IoCModuleKeys<TRequires, TNeeds>>): unknown;
}

/**
 * Defines a typed module. Inside `Register`, the container is typed with the keys the module
 * `Needs` and the keys its `Requires` register themselves, so `Deps` can only name those and the module's own
 * earlier registrations. Return the registration chain: its keys become what the module provides.
 * On a {@link IoCContainer.Typed typed container}, `Use(module)` adds those keys, and only
 * compiles when the container already has what the module needs.
 *
 * Each module type-checks its own short chain, so large applications stay fast to compile.
 *
 * @example
 * ```ts
 * import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';
 *
 * const $Url = IoCToken<string, 'Url'>('Url');
 *
 * class Repo {
 *   constructor(public url: string) {}
 * }
 *
 * const RepoModule = DefineModule({
 *   Name: 'Repo',
 *   Needs: [$Url],
 *   Register: (ioc) => ioc.RegisterClass(Repo, { Deps: [$Url] }),
 * });
 *
 * const ioc = new IoCContainer()
 *   .Typed()
 *   .RegisterValue($Url, 'kv://local')
 *   .Use(RepoModule); // compiles: $Url is registered; Repo is now typed in
 *
 * console.log((await ioc.Resolve(Repo)).url); // kv://local
 * ```
 */
export function DefineModule<
  // deno-lint-ignore no-explicit-any
  const TRequires extends readonly IoCModule<any, any>[] = [],
  const TNeeds extends readonly (
    // deno-lint-ignore no-explicit-any
    IoCDependencyKey<any> | readonly [IoCDependencyKey<any>, string]
  )[] = [],
  TResult = unknown,
>(
  definition: IoCModuleDefinition<TRequires, TNeeds, TResult>,
): IoCModule<
  IoCExpected<TNeeds> | Exclude<IoCModulesNeed<TRequires>, IoCModulesProvide<TRequires>>,
  Exclude<IoCKeysOf<TResult>, IoCModuleKeys<TRequires, TNeeds>>
> {
  return definition as unknown as IoCModule<
    IoCExpected<TNeeds> | Exclude<IoCModulesNeed<TRequires>, IoCModulesProvide<TRequires>>,
    Exclude<IoCKeysOf<TResult>, IoCModuleKeys<TRequires, TNeeds>>
  >;
}
