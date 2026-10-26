import {
  IoCActivationError,
  IoCCircularDependencyError,
  IoCContainerDisposedError,
  IoCDisposeError,
  IoCDuplicateRegistrationError,
  IoCModuleCycleError,
  IoCNotIsolatableError,
  IoCRegistrationError,
  IoCResolveTimeoutError,
  IoCScopeRequiredError,
  IoCServiceNotFoundError,
  IoCStartError,
  IoCValidationError,
  type IoCValidationIssue,
} from './errors.ts';
import {
  type AnyFunction,
  constructorArity,
  disposeOne,
  framePath,
  IOC_EXTERNAL,
  IOC_FRAME,
  IOC_OWNERS,
  IOC_SELF,
  type IoCDependencyRecord,
  type IoCHolder,
  type IoCKey,
  type IoCLifetime,
  type IoCRegistration,
  type IoCResolveFrame,
  isClassLike,
  isDisposable,
  isOnPath,
  keyDescription,
  labelFor,
  noop,
} from './internals.ts';
import type { IoCModule, IoCModulesNeed, IoCModulesProvide } from './IoCModule.ts';
import type { IoCToken } from './IoCToken.ts';

/** Where the container is in its lifecycle (see {@link IoCContainer.State}). */
export type IoCContainerState = 'idle' | 'starting' | 'started' | 'stopping' | 'disposed';

/** Options for a container. Its scopes inherit them. */
export interface IoCContainerOptions {
  /**
   * Fails a resolve, a module's `OnStart`/`OnStop`, or an instance's disposer that is still
   * pending after this many milliseconds, with an `IoCResolveTimeoutError`, instead of waiting
   * forever. Defaults to 30 000; `0` turns it off.
   */
  PendingTimeoutMs?: number;
}

/** One registration, as reported by {@link IoCContainer.Describe}. */
export interface IoCServiceDescription {
  /** The key's description (the token name, or the class name). */
  Key: string;

  /** The registration name (`$default` when unnamed). */
  Name: string;

  /** `Key` or `Key[name]`, as used in error messages. */
  Label: string;

  /** How it was registered. */
  Kind: 'class' | 'factory' | 'value';

  /** The lifetime. */
  Lifetime: 'singleton' | 'scoped' | 'transient';

  /** Registered with `Default: true`. */
  Default: boolean;

  /** Declared dependencies (`Deps`), as labels. */
  Deps: string[];

  /** 0 for this container, 1 for its parent, and so on. */
  Depth: number;
}

/** What {@link IoCContainer.Describe} returns. */
export interface IoCDescription {
  /** The container's lifecycle state. */
  State: IoCContainerState;

  /** True for a scope (a container with a parent). */
  Scope: boolean;

  /** Every registration visible from this container, nearest first (shadowed ones left out). */
  Services: IoCServiceDescription[];

  /** The modules added to this container, in start order. */
  Modules: { Name: string; Requires: string[]; Started: boolean }[];
}

/** A class that can be registered and used as a resolution key. */
// deno-lint-ignore no-explicit-any
export type IoCServiceConstructor<T> = { new (...args: any[]): T };

/**
 * A class used only as a key (it is never constructed by the container), so abstract classes
 * work as typed "interface" keys: `ioc.RegisterFactory(Repo, () => new PgRepo())`.
 */
// deno-lint-ignore no-explicit-any
export type IoCServiceKeyConstructor<T> = abstract new (...args: any[]) => T;

/** Anything a service can be registered and resolved by: a typed token, or a class. */
export type IoCServiceKey<T> = IoCToken<T, string> | IoCServiceKeyConstructor<T>;

/** The service type a key resolves to: the token's type, the class's instance, else `unknown`. */
export type IoCServiceOf<TKey> = TKey extends IoCToken<infer T, string> ? T
  : TKey extends IoCServiceKeyConstructor<infer T> ? T
  : unknown;

/** Options shared by every registration method. */
export type IoCServiceOptions = {
  /**
   * `singleton` (default): one shared instance. `transient`: a new instance per resolve.
   * `scoped`: one instance per scope (see {@link IoCContainer.CreateScope}).
   */
  Lifetime?: 'transient' | 'scoped';

  /** Registers under a name, so several services can share one key (`$default` when omitted). */
  Name?: string;

  /**
   * Registers a default that yields to any other registration of the same key and name, whatever
   * the order: if one exists (here or in a parent) this call does nothing, and a later
   * registration replaces it. Frameworks use it for the services an application may replace.
   */
  Default?: boolean;

  /** Replaces an existing registration on purpose. Without it, registering again throws. */
  Replace?: boolean;
};

/** A dependency key: a typed token, or a class (abstract classes included). */
export type IoCDependencyKey<T> = IoCToken<T, string> | IoCServiceKeyConstructor<T>;

/** A declared dependency: a key, or `[key, name]` for a named registration. */
export type IoCDependency<T> = IoCDependencyKey<T> | readonly [IoCDependencyKey<T>, string];

/** The value a dependency injects. */
export type IoCDependencyValue<D> = D extends readonly [infer K, string] ? IoCServiceOf<K>
  : IoCServiceOf<D>;

/** The values a list of dependencies injects, in order. */
export type IoCDependencyValues<TDeps extends readonly unknown[]> = {
  -readonly [I in keyof TDeps]: IoCDependencyValue<TDeps[I]>;
};

/**
 * The registry of a {@link IoCContainer.Typed typed container} that has nothing registered yet.
 * No dependency matches it.
 */
export type IoCNoKeys = {
  /** Type-only marker; never present at runtime, so no value matches an empty registry. */
  readonly '@fathym/ioc/no-keys': true;
};

/**
 * The dependencies a container's registry allows: every key when the container is untyped
 * (`any`), otherwise only the keys registered (or expected) so far.
 */
export type IoCAllowedKeys<TKeys> = 0 extends (1 & TKeys) ? unknown : TKeys;

/**
 * One dependency per constructor parameter, each typed to match its parameter and, on a typed
 * container, limited to the keys already registered.
 */
// deno-lint-ignore no-explicit-any
export type IoCDependenciesFor<P extends readonly unknown[], TKeys = any> = {
  readonly [K in keyof P]: IoCDependency<P[K]> & IoCAllowedKeys<TKeys>;
};

/** A dependency a factory may declare in `Deps`: on a typed container, a key registered so far. */
// deno-lint-ignore no-explicit-any
export type IoCFactoryDependency<TKeys = any> = IoCDependency<any> & IoCAllowedKeys<TKeys>;

/**
 * What a registration adds to a typed container's registry: the key itself for the default name,
 * or `[key, name]` for a named registration.
 */
export type IoCRegistered<TKey, TName extends string = '$default'> = TKey extends // deno-lint-ignore no-explicit-any
IoCToken<any, string> | IoCServiceKeyConstructor<any>
  ? (string extends TName ? readonly [TKey, string]
    : TName extends '$default' ? TKey
    : readonly [TKey, TName])
  : never;

/** What {@link IoCContainer.Expect} adds to a typed container's registry. */
export type IoCExpected<TDeps extends readonly unknown[]> = {
  [I in keyof TDeps]: TDeps[I] extends readonly [infer K, infer N extends string]
    ? IoCRegistered<K, N>
    : IoCRegistered<TDeps[I]>;
}[number];

/**
 * The `Type` option of {@link IoCContainer.RegisterClass}: a token whose type the class's
 * instances satisfy.
 */
export type IoCTypeFor<TInstance, TType> = TType extends IoCToken<infer T, string>
  ? ([TInstance] extends [T] ? TType : IoCTypeMismatch<TInstance, T>)
  : TType;

/** Reported when `RegisterClass(clazz, { Type })` names a token the class does not satisfy. */
export type IoCTypeMismatch<TInstance, TService> = {
  readonly '@fathym/ioc/error': 'The class does not implement the type of the Type token.';
  readonly instance: TInstance;
  readonly service: TService;
};

/** Options accepted by {@link IoCContainer.RegisterClass}. */
export type IoCRegisterClassOptions<
  C extends IoCServiceConstructor<unknown>,
  // deno-lint-ignore no-explicit-any
  TKeys = any,
  TName extends string = string,
  // deno-lint-ignore no-explicit-any
  TType extends IoCToken<any, string> = IoCToken<any, string>,
> =
  & Omit<IoCServiceOptions, 'Name'>
  & {
    /**
     * The services to pass to the constructor, in parameter order, checked against the
     * constructor's parameter types (and, on a {@link IoCContainer.Typed typed container},
     * against the keys registered so far). The container resolves them (in the resolving scope)
     * and calls `new clazz(...deps)`. Declared dependencies are also checked by `Validate()`.
     */
    Deps?: IoCDependenciesFor<ConstructorParameters<C>, TKeys>;

    /** Registers under a name, so several services can share one key (`$default` when omitted). */
    Name?: TName;

    /**
     * The key to register under instead of the class: a token whose type the class satisfies
     * (`RegisterClass(PgDb, { Type: $Db })`).
     */
    Type?: IoCTypeFor<InstanceType<C>, TType>;

    /** Cleans up the instance when its owner is disposed (instead of `Symbol.asyncDispose`). */
    Dispose?: (instance: InstanceType<C>) => unknown;
  };

/** Options for registrations whose key is given separately. */
export type IoCRegisterOptions<TName extends string = string, T = unknown> =
  & Omit<IoCServiceOptions, 'Name'>
  & {
    /** Registers under a name, so several services can share one key (`$default` when omitted). */
    Name?: TName;

    /**
     * Cleans up the instance when the container (or scope) that owns it is disposed, for
     * resources that don't implement `Symbol.asyncDispose` / `Symbol.dispose` (`kv => kv.close()`).
     */
    Dispose?: (instance: T) => unknown;
  };

/** A factory: receives the container and returns the service (or a promise of it). */
export type IoCServiceResolver<T> = (ioc: IoCContainer) => T | Promise<T>;

/** Reported by `Use()` on a typed container when a module needs keys the container lacks. */
export type IoCUnmetNeeds<TKeys, TModules> = Exclude<
  IoCModulesNeed<TModules>,
  TKeys | IoCModulesProvide<TModules>
>;

/**
 * Makes `Use()` fail to compile, naming the missing keys, when a module's needs are unmet. An
 * untyped container (`any` registry) checks nothing.
 */
export type IoCCheckNeeds<TKeys, TModules> = 0 extends (1 & TKeys) ? unknown
  : [IoCUnmetNeeds<TKeys, TModules>] extends [never] ? unknown
  : { readonly '@fathym/ioc/unmet-needs': IoCUnmetNeeds<TKeys, TModules> };

// deno-lint-ignore no-explicit-any
type Indexable = any;

const DEFAULT_NAME = '$default';

const DEFAULT_TIMEOUT_MS = 30_000;

// Timers overflow above 2^31 - 1 ms (about 24.8 days) and would fire at once.
const MAX_TIMEOUT_MS = 2_147_483_647;

// Timers exist in every supported runtime, but not in the plain ES lib the npm build compiles with.
const host = globalThis as unknown as {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};

/** A registration being stored: everything but what the container fills in. */
interface IoCRegistrationSpec {
  key: unknown;
  name?: string;
  kind: IoCRegistration['kind'];
  ctor?: AnyFunction;
  factory: (ioc: IoCContainer) => unknown;
  deps?: IoCDependencyRecord[];
  options: IoCServiceOptions;
  dispose?: (instance: unknown) => unknown;
  /** For values: the value, ready from the start. */
  value?: { value: unknown };
}

/** A registration of this library: the record plus the container that stores it. */
interface IoCStored extends IoCRegistration {
  readonly owner: IoCContainer;
}

/** An instance a container must dispose. */
interface IoCOwned {
  value: unknown;
  label: string;
  dispose?: (instance: unknown) => unknown;
}

/** Throws `IOC_INVALID_KEY` unless `key` is a token (a symbol) or a class. */
function checkKey(key: unknown): IoCKey {
  if (typeof key === 'symbol' || isClassLike(key)) return key as IoCKey;

  const kind = key === null
    ? 'null'
    : typeof key === 'function'
    ? 'function that is not a class'
    : typeof key === 'object'
    ? 'plain object'
    : typeof key;

  throw new IoCRegistrationError(
    `Keys must be tokens or classes, but a ${kind} was given. Create a token with ` +
      `IoCToken<T>('Name').`,
    'IOC_INVALID_KEY',
  );
}

function normalizeDependency(dep: unknown): IoCDependencyRecord {
  if (Array.isArray(dep)) {
    return { key: checkKey(dep[0]), name: (dep[1] as string) || DEFAULT_NAME };
  }

  return { key: checkKey(dep), name: DEFAULT_NAME };
}

/**
 * A small, async-first, decorator-free inversion-of-control container.
 *
 * Docs: https://github.com/fathym/ioc/blob/main/docs/README.md
 *
 * @example Register and resolve
 * ```ts
 * import { IoCContainer, IoCToken } from '@fathym/ioc';
 *
 * const $DbUrl = IoCToken<string>('DbUrl');
 *
 * class Repo {
 *   constructor(public url: string) {}
 * }
 *
 * const ioc = new IoCContainer()
 *   .RegisterValue($DbUrl, 'kv://local')
 *   .RegisterClass(Repo, { Deps: [$DbUrl] });
 *
 * console.log((await ioc.Resolve(Repo)).url); // kv://local
 * ```
 *
 * @example A typed container: `Deps` may only name what is already registered
 * ```ts
 * import { IoCContainer, IoCToken } from '@fathym/ioc';
 *
 * const $DbUrl = IoCToken<string, 'DbUrl'>('DbUrl');
 *
 * class Repo {
 *   constructor(public url: string) {}
 * }
 *
 * const ioc = new IoCContainer()
 *   .Typed()
 *   .RegisterValue($DbUrl, 'kv://local')
 *   .RegisterClass(Repo, { Deps: [$DbUrl] }); // a key registered later would not compile
 *
 * const repo = await ioc.Resolve(Repo); // repo: Repo
 * ```
 *
 * @typeParam TKeys The keys registered so far on a {@link IoCContainer.Typed typed container}.
 * `any` (the default) means untyped: `Deps` accepts any key of the right type.
 */
// deno-lint-ignore no-explicit-any
export class IoCContainer<TKeys = any> {
  /**
   * Type-only marker that makes containers with different registries incompatible; never present
   * at runtime.
   *
   * @ignore
   */
  declare readonly '@fathym/ioc/keys'?: (keys: TKeys) => void;

  /** @ignore */
  protected readonly registrations: Map<IoCKey, Map<string, IoCStored>> = new Map();

  /** @ignore */
  protected parent?: IoCContainer;

  /**

   * This scope's instances of `scoped` registrations.

   *

   * @ignore
   */
  protected readonly scopedHolders: Map<IoCRegistration, IoCHolder> = new Map();

  /**

   * Instances this container created and must dispose, in creation order.

   *

   * @ignore
   */
  protected readonly owned: IoCOwned[] = [];

  /**

   * Keys declared with `Expect()`, by name.

   *

   * @ignore
   */
  protected readonly expected: Map<IoCKey, Set<string>> = new Map();

  /**

   * The modules added here, in start order.

   *

   * @ignore
   */
  protected readonly modules: IoCModule[] = [];

  /**

   * The modules whose `OnStart` succeeded, in start order.

   *

   * @ignore
   */
  protected readonly started: IoCModule[] = [];

  /**

   * Live scopes that own something to dispose.

   *

   * @ignore
   */
  protected readonly children: Set<IoCContainer> = new Set();

  /**

   * Whether the parent tracks this scope.

   *

   * @ignore
   */
  protected retained = false;

  /** @ignore */
  protected state: IoCContainerState = 'idle';

  /** @ignore */
  protected disposed = false;

  /** @ignore */
  protected starting?: Promise<void>;

  /** @ignore */
  protected disposing?: Promise<void>;

  /** @ignore */
  protected readonly options: Readonly<IoCContainerOptions>;

  /** Creates a container. */
  constructor(options?: IoCContainerOptions) {
    const ms = options?.PendingTimeoutMs;

    if (ms !== undefined && (!(ms >= 0) || !(ms <= MAX_TIMEOUT_MS))) {
      throw new IoCRegistrationError(
        `PendingTimeoutMs must be a number of milliseconds from 0 (off) to 2147483647 (about ` +
          `24.8 days).`,
      );
    }

    this.options = Object.freeze({ ...options });

    (this as Indexable)[IOC_SELF] = this;
  }

  /**
   * Where the container is in its lifecycle: `idle` (created, or after a failed `Start()`),
   * `starting`, `started`, `stopping` or `disposed`.
   */
  public get State(): IoCContainerState {
    return this.self().state;
  }

  //#region Registration

  /**
   * Returns this container typed with an empty registry. From then on, each registration adds
   * its key to the container's type, and `Deps` may only name keys registered (or expected)
   * earlier, so a missing dependency doesn't compile. Runtime behavior is unchanged.
   */
  public Typed(): IoCContainer<IoCNoKeys> {
    return this as unknown as IoCContainer<IoCNoKeys>;
  }

  /**
   * Declares keys that will be registered later or elsewhere (per scope, or by the code that
   * hosts this container), so a typed container lets `Deps` name them now. `Validate()` treats
   * them as registered. Nothing is registered.
   */
  public Expect<
    const TDeps extends readonly (
      // deno-lint-ignore no-explicit-any
      IoCDependencyKey<any> | readonly [IoCDependencyKey<any>, string]
    )[],
  >(...deps: TDeps): IoCContainer<TKeys | IoCExpected<TDeps>> {
    const self = this.self();

    for (const dep of deps) {
      const { key, name } = normalizeDependency(dep);

      let names = self.expected.get(key);

      if (!names) self.expected.set(key, names = new Set());

      names.add(name);
    }

    return this as unknown as IoCContainer<TKeys | IoCExpected<TDeps>>;
  }

  /**
   * Registers a class, keyed by the class itself (or by `Type`). With `Deps`, the container
   * resolves them and passes them to the constructor, in order.
   */
  public RegisterClass<
    C extends IoCServiceConstructor<unknown>,
    const TName extends string = '$default',
    // deno-lint-ignore no-explicit-any
    TType extends IoCToken<any, string> = never,
  >(
    clazz: C,
    options?: IoCRegisterClassOptions<C, TKeys, TName, TType>,
  ): IoCContainer<
    TKeys | ([TType] extends [never] ? IoCRegistered<C, TName> : IoCRegistered<TType, TName>)
  > {
    if (!isClassLike(clazz)) {
      throw new IoCRegistrationError(
        `RegisterClass expects a class; register functions with RegisterFactory and other ` +
          `values with RegisterValue.`,
      );
    }

    const opts = { ...options };

    const deps = opts.Deps?.map(normalizeDependency);

    this.addRegistration({
      key: opts.Type === undefined ? clazz : opts.Type,
      name: opts.Name,
      kind: 'class',
      ctor: clazz,
      factory: deps ? async (ioc) => new clazz(...await resolveAll(ioc, deps)) : () => new clazz(),
      deps,
      options: opts,
      dispose: opts.Dispose as ((instance: unknown) => unknown) | undefined,
    });

    return this as unknown as IoCContainer<
      TKeys | ([TType] extends [never] ? IoCRegistered<C, TName> : IoCRegistered<TType, TName>)
    >;
  }

  /**
   * Registers a factory. It receives the container (resolve through it, so cycles are reported)
   * and, with `Deps`, the resolved dependencies after it.
   */
  public RegisterFactory<
    K extends IoCServiceKey<unknown>,
    const TName extends string = '$default',
    const TDeps extends readonly IoCFactoryDependency<TKeys>[] = [],
  >(
    key: K,
    factory: (
      ioc: IoCContainer,
      ...deps: IoCDependencyValues<TDeps>
    ) => IoCServiceOf<K> | Promise<IoCServiceOf<K>>,
    options?: IoCRegisterOptions<TName, IoCServiceOf<K>> & {
      /** Dependencies passed to the factory after the container, in order. */
      Deps?: TDeps;
    },
  ): IoCContainer<TKeys | IoCRegistered<K, TName>> {
    if (typeof factory !== 'function') {
      throw new IoCRegistrationError(`RegisterFactory expects a factory function.`);
    }

    const opts = { ...options };

    const deps = opts.Deps?.map(normalizeDependency);

    const call = factory as (ioc: IoCContainer, ...deps: unknown[]) => unknown;

    this.addRegistration({
      key,
      name: opts.Name,
      kind: 'factory',
      factory: deps ? async (ioc) => call(ioc, ...await resolveAll(ioc, deps)) : (ioc) => call(ioc),
      deps,
      options: opts,
      dispose: opts.Dispose as ((instance: unknown) => unknown) | undefined,
    });

    return this as unknown as IoCContainer<TKeys | IoCRegistered<K, TName>>;
  }

  /**
   * Registers a value. It is shared as is, and never disposed by the container unless a `Dispose`
   * option says how.
   */
  public RegisterValue<K extends IoCServiceKey<unknown>, const TName extends string = '$default'>(
    key: K,
    value: IoCServiceOf<K>,
    options?: {
      /** Registers under a name (`$default` when omitted). */
      Name?: TName;

      /** Cleans the value up when this container is disposed. */
      Dispose?: (value: IoCServiceOf<K>) => unknown;

      /** Registers a default that yields to any other registration (see `IoCServiceOptions`). */
      Default?: boolean;

      /** Replaces an existing registration on purpose. */
      Replace?: boolean;
    },
  ): IoCContainer<TKeys | IoCRegistered<K, TName>> {
    this.addRegistration({
      key,
      name: options?.Name,
      kind: 'value',
      factory: () => value,
      value: { value },
      options: { Default: options?.Default, Replace: options?.Replace },
      dispose: options?.Dispose as ((instance: unknown) => unknown) | undefined,
    });

    return this as unknown as IoCContainer<TKeys | IoCRegistered<K, TName>>;
  }

  /** Removes a registration from this container (not from parents). Returns whether one existed. */
  public Unregister(key: IoCServiceKey<unknown>, name?: string): boolean {
    return this.self().registrations.get(checkKey(key))?.delete(name || DEFAULT_NAME) ?? false;
  }

  /**
   * Replaces a registration with a value until the returned function is called, which puts back
   * exactly what was there before. For tests. Instances already built from the old registration
   * keep what they were given, so override before resolving the services that use it, or
   * override in a scope.
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Clock = IoCToken<() => number>('Clock');
   *
   * const ioc = new IoCContainer().RegisterValue($Clock, () => Date.now());
   *
   * const restore = ioc.Override($Clock, () => 0);
   *
   * console.log((await ioc.Resolve($Clock))()); // 0
   *
   * restore();
   * ```
   */
  public Override<K extends IoCServiceKey<unknown>>(
    key: K,
    value: IoCServiceOf<K>,
    options?: { Name?: string },
  ): () => void {
    const self = this.self();

    const k = checkKey(key);

    const name = options?.Name || DEFAULT_NAME;

    const previous = self.registrations.get(k)?.get(name);

    self.RegisterValue(key, value, { Name: name, Replace: true });

    const override = self.registrations.get(k)?.get(name);

    return () => {
      const bank = self.registrations.get(k);

      // Something replaced the override since; leave it alone.
      if (!bank || bank.get(name) !== override) return;

      if (previous) bank.set(name, previous);
      else bank.delete(name);
    };
  }

  //#endregion

  //#region Resolution

  /** Resolves a service by its token or class, optionally by name. */
  public async Resolve<K extends IoCServiceKey<unknown>>(
    key: K,
    name?: string,
  ): Promise<IoCServiceOf<K>> {
    const self = this.self();

    self.assertNotDisposed();

    const frame = this.frame();

    const reg = self.lookup(checkKey(key), name || DEFAULT_NAME, frame);

    return await self.timed(self.resolveIn(reg, frame), reg.label) as IoCServiceOf<K>;
  }

  /** Resolves a service, or `undefined` when nothing is registered for it. */
  public async TryResolve<K extends IoCServiceKey<unknown>>(
    key: K,
    name?: string,
  ): Promise<IoCServiceOf<K> | undefined> {
    return this.Has(key, name) ? await this.Resolve(key, name) : undefined;
  }

  /** Resolves every registration of a key, one per name, nearest scope first. */
  public async ResolveAll<K extends IoCServiceKey<unknown>>(key: K): Promise<IoCServiceOf<K>[]> {
    return await Promise.all(this.Names(key).map((name) => this.Resolve(key, name)));
  }

  /** Resolves every registration of a key into a map of name to service. */
  public async ResolveNamed<K extends IoCServiceKey<unknown>>(
    key: K,
  ): Promise<Map<string, IoCServiceOf<K>>> {
    const names = this.Names(key);

    const values = await Promise.all(names.map((name) => this.Resolve(key, name)));

    return new Map(names.map((name, i) => [name, values[i]]));
  }

  /**
   * Resolves several services at once into an object with the same keys:
   * `await ioc.ResolveRecord({ db: $Db, cache: [$Cache, 'hot'] })`.
   */
  public async ResolveRecord<
    // deno-lint-ignore no-explicit-any
    const R extends Record<string, IoCDependency<any>>,
  >(record: R): Promise<{ -readonly [K in keyof R]: IoCDependencyValue<R[K]> }> {
    const entries = Object.entries(record);

    const values = await resolveAll(this, entries.map(([, dep]) => normalizeDependency(dep)));

    return Object.fromEntries(entries.map(([k], i) => [k, values[i]])) as {
      -readonly [K in keyof R]: IoCDependencyValue<R[K]>;
    };
  }

  /** The names registered for a key, here and in parents, nearest first. */
  public Names(key: IoCServiceKey<unknown>): string[] {
    const k = checkKey(key);

    const names = new Set<string>();

    for (const container of this.self().chain()) {
      for (const name of container.registrations.get(k)?.keys() ?? []) names.add(name);
    }

    return [...names];
  }

  /** True when a registration exists for the key and name, here or in a parent. */
  public Has(key: IoCServiceKey<unknown>, name?: string): boolean {
    return !!this.self().find(checkKey(key), name || DEFAULT_NAME);
  }

  //#endregion

  //#region Scopes

  /**
   * Creates a child scope. The scope resolves everything its parent can; `scoped` registrations
   * get one instance per scope, singletons stay shared with the parent, and registrations made on
   * the scope override the parent's for this scope only (handy per request, per command, and in
   * tests). Dispose it when done (`await using scope = ioc.CreateScope()`); disposing the parent
   * disposes its live scopes too.
   *
   * @example
   * ```ts
   * import { IoCContainer } from '@fathym/ioc';
   *
   * class RequestId {
   *   public id = crypto.randomUUID();
   * }
   *
   * const ioc = new IoCContainer().RegisterClass(RequestId, { Lifetime: 'scoped' });
   *
   * await using a = ioc.CreateScope();
   * await using b = ioc.CreateScope();
   *
   * console.log((await a.Resolve(RequestId)) === (await a.Resolve(RequestId))); // true
   * console.log((await a.Resolve(RequestId)) === (await b.Resolve(RequestId))); // false
   * ```
   */
  public CreateScope(): IoCContainer<TKeys> {
    const self = this.self();

    self.assertNotDisposed();

    const scope = new IoCContainer(self.options);

    scope.parent = self;

    return scope as unknown as IoCContainer<TKeys>;
  }

  /**
   * Gives this scope its own copy of registrations it inherits, so singletons among them get one
   * instance in this scope (built from this scope's registrations) instead of sharing the
   * parent's. Values can't be isolated: every scope shares them as they are.
   */
  public Isolate(
    ...keys: (IoCServiceKey<unknown> | readonly [IoCServiceKey<unknown>, string])[]
  ): this {
    const self = this.self();

    self.assertNotDisposed();

    if (!self.parent) {
      throw new IoCRegistrationError(
        'Isolate() works on scopes; call it on a container created with CreateScope().',
      );
    }

    for (const item of keys) {
      const { key, name } = normalizeDependency(item);

      const reg = self.parent.lookup(key, name, undefined);

      if (reg.kind === 'value') {
        throw new IoCNotIsolatableError(reg.label, 'it is a value, which every scope shares as is');
      }

      self.store({
        ...reg,
        owner: self,
        holder: reg.lifetime === 'singleton' ? { state: 'empty' } : undefined,
      });
    }

    return this;
  }

  //#endregion

  //#region Modules and lifecycle

  /**
   * Adds modules, and the modules they `Requires` first. Each module's `Register` runs once, with
   * this container. On a {@link IoCContainer.Typed typed container}, a module's `Needs` must
   * already be registered, and what it registers is typed in.
   *
   * @example
   * ```ts
   * import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';
   *
   * const $Url = IoCToken<string>('Url');
   *
   * const Data: IoCModule = {
   *   Name: 'Data',
   *   Register: (ioc) => ioc.RegisterValue($Url, 'kv://local', { Default: true }),
   *   OnStart: () => console.log('data ready'),
   * };
   *
   * await using ioc = new IoCContainer().Use(Data);
   *
   * await ioc.Start(); // data ready
   * ```
   */
  // deno-lint-ignore no-explicit-any
  public Use<const TModules extends readonly IoCModule<any, any>[]>(
    ...modules: TModules & IoCCheckNeeds<TKeys, TModules>
  ): IoCContainer<TKeys | IoCModulesProvide<TModules>> {
    const self = this.self();

    self.assertNotDisposed();

    const visit = (module: IoCModule, path: IoCModule[]) => {
      if (!module || typeof module.Name !== 'string' || typeof module.Register !== 'function') {
        throw new IoCRegistrationError('A module needs a Name and a Register(ioc) function.');
      }

      if (path.includes(module)) {
        const cycle = [...path.slice(path.indexOf(module)), module].map((m) => m.Name);

        throw new IoCModuleCycleError(cycle);
      }

      if (self.hasModule(module)) return;

      for (const required of module.Requires ?? []) visit(required, [...path, module]);

      if (self.state !== 'idle') {
        throw new IoCRegistrationError(
          `Module '${module.Name}' was added after Start(); add modules before starting the ` +
            `container, or give late plugins a scope: ioc.CreateScope().Use(plugin).`,
        );
      }

      module.Register(self);

      self.modules.push(module);

      self.retain();
    };

    for (const module of modules as readonly IoCModule[]) visit(module, []);

    return this as unknown as IoCContainer<TKeys | IoCModulesProvide<TModules>>;
  }

  /**
   * Validates the registrations (see {@link IoCContainer.Validate}), then runs each module's
   * `OnStart`, in the order they were added (a module after the modules it requires). If one
   * fails, the modules that started are stopped again, in reverse, and `Start()` throws an
   * `IoCStartError`; it can then be called again. Concurrent and repeated calls share one start.
   * Services are still built when first resolved; call {@link IoCContainer.Activate} to build
   * every singleton now.
   */
  public Start(options?: { Validate?: boolean }): Promise<void> {
    const self = this.self();

    if (self.state === 'started') return Promise.resolve();

    self.starting ??= self.startNow(options).finally(() => {
      self.starting = undefined;
    });

    return self.starting;
  }

  /**
   * Builds every singleton registered on this container now, so a broken service fails at boot
   * rather than on first use. Throws one `IoCActivationError` naming every service that failed.
   */
  public async Activate(): Promise<void> {
    const self = this.self();

    self.assertNotDisposed();

    const failures: { label: string; error: unknown }[] = [];

    const work: Promise<void>[] = [];

    for (const bank of self.registrations.values()) {
      for (const reg of bank.values()) {
        if (reg.lifetime !== 'singleton') continue;

        work.push(
          Promise.resolve()
            .then(() => self.timed(self.resolveIn(reg, undefined), reg.label))
            .then(noop, (error) => void failures.push({ label: reg.label, error })),
        );
      }
    }

    await Promise.all(work);

    if (failures.length) {
      throw new IoCActivationError(failures.map((f) => f.error), failures.map((f) => f.label));
    }
  }

  /**
   * Shuts the container down: waits for a running `Start()`, runs `OnStop` of every started module
   * (its live scopes' modules first, then its own, in reverse start order), disposes its live
   * scopes, then disposes every instance it created, in reverse creation order. Every step runs even if an earlier one fails; failures are thrown
   * together as an `IoCDisposeError`. Calling it again returns the same promise.
   */
  public Dispose(): Promise<void> {
    const self = this.self();

    self.disposing ??= self.disposeNow();

    return self.disposing;
  }

  /** Disposes the container (see {@link IoCContainer.Dispose}); enables `await using`. */
  public async [Symbol.asyncDispose](): Promise<void> {
    await this.Dispose();
  }

  //#endregion

  //#region Inspection

  /**
   * Checks the registrations visible from this container without building anything, and throws
   * one `IoCValidationError` listing every problem:
   *
   * - `missing`: a declared dependency (`Deps`) that isn't registered (or expected);
   * - `cycle`: services whose declared dependencies loop;
   * - `captive`: a singleton that depends, directly or through transients, on a scoped service,
   *   which it would keep forever;
   * - `arguments`: a class registered without `Deps` whose constructor takes parameters.
   *
   * Only declared `Deps` are checked: what a factory resolves in its body is only known when it
   * runs. Pass `{ Throw: false }` to get the issues back instead.
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Url = IoCToken<string>('Url');
   *
   * class Repo {
   *   constructor(public url: string) {}
   * }
   *
   * const ioc = new IoCContainer().RegisterClass(Repo, { Deps: [$Url] });
   *
   * console.log(ioc.Validate({ Throw: false }).map((i) => i.Message));
   * // [ "Repo depends on Url, which is not registered." ]
   * ```
   */
  public Validate(options?: { Throw?: boolean }): IoCValidationIssue[] {
    const self = this.self();

    const issues: IoCValidationIssue[] = [];

    const visible = self.visible().map(({ reg }) => reg);

    const find = (dep: IoCDependencyRecord) => self.find(dep.key, dep.name);

    for (const reg of visible) {
      if (reg.kind === 'class' && !reg.deps && reg.ctor) {
        const arity = constructorArity(reg.ctor);

        if (arity > 0) {
          issues.push({
            Kind: 'arguments',
            Service: reg.label,
            Message: `${reg.label} is constructed without arguments, but its constructor ` +
              `declares ${arity} parameter(s); register it with Deps or with a factory.`,
          });
        }
      }

      for (const dep of reg.deps ?? []) {
        if (!find(dep) && !self.isExpected(dep)) {
          issues.push({
            Kind: 'missing',
            Service: reg.label,
            Message: `${reg.label} depends on ${labelFor(dep.key, dep.name)}, which is not ` +
              `registered.`,
          });
        }
      }

      if (reg.lifetime === 'singleton') {
        const seen = new Set<IoCRegistration>();

        const visit = (current: IoCRegistration, via: string[]) => {
          for (const dep of current.deps ?? []) {
            const target = find(dep);

            if (!target || seen.has(target)) continue;

            seen.add(target);

            if (target.lifetime === 'transient') visit(target, [...via, target.label]);
            else if (target.lifetime === 'scoped') {
              issues.push({
                Kind: 'captive',
                Service: reg.label,
                Message: `singleton ${reg.label} depends on scoped ${target.label}` +
                  `${via.length ? ` (through ${via.join(' -> ')})` : ''}; it would keep one ` +
                  `instance for its whole life. Make ${reg.label} scoped, or resolve ` +
                  `${target.label} where it is used, from the scope at hand.`,
              });
            }
          }
        };

        visit(reg, []);
      }
    }

    // Cycles through declared dependencies (depth-first, each cycle reported once).
    const state = new Map<IoCRegistration, 'visiting' | 'done'>();

    const reported = new Set<string>();

    const walk = (reg: IoCRegistration, path: IoCRegistration[]) => {
      if (state.get(reg) === 'done') return;

      if (state.get(reg) === 'visiting') {
        const cycle = path.slice(path.indexOf(reg)).map((r) => r.label);

        const id = [...cycle].sort().join('|');

        if (!reported.has(id)) {
          reported.add(id);

          issues.push({
            Kind: 'cycle',
            Service: reg.label,
            Message: `Circular dependency: ${[...cycle, reg.label].join(' -> ')}.`,
          });
        }

        return;
      }

      state.set(reg, 'visiting');

      for (const dep of reg.deps ?? []) {
        const target = find(dep);

        if (target) walk(target, [...path, reg]);
      }

      state.set(reg, 'done');
    };

    for (const reg of visible) walk(reg, []);

    if (issues.length && options?.Throw !== false) throw new IoCValidationError(issues);

    return issues;
  }

  /** Lists the registrations visible from this container and its modules, as plain data. */
  public Describe(): IoCDescription {
    const self = this.self();

    return {
      State: self.state,
      Scope: !!self.parent,
      Services: self.visible().map(({ reg, depth }) => ({
        Key: keyDescription(reg.key),
        Name: reg.name,
        Label: reg.label,
        Kind: reg.kind,
        Lifetime: reg.lifetime,
        Default: !!reg.default,
        Deps: (reg.deps ?? []).map((d) => labelFor(d.key, d.name)),
        Depth: depth,
      })),
      Modules: self.modules.map((m) => ({
        Name: m.Name,
        Requires: (m.Requires ?? []).map((r) => r.Name),
        Started: self.started.includes(m),
      })),
    };
  }

  //#endregion

  //#region Internals

  /**

   * The real container behind a view.

   *

   * @ignore
   */
  protected self(): IoCContainer {
    return (this as Indexable)[IOC_SELF];
  }

  /**

   * The resolution frame a view carries, if this is a factory's view.

   *

   * @ignore
   */
  protected frame(): IoCResolveFrame | undefined {
    return (this as Indexable)[IOC_FRAME];
  }

  /**

   * This container, then its parents.

   *

   * @ignore
   */
  protected *chain(): Generator<IoCContainer> {
    yield this;

    for (let c = this.parent; c; c = c.parent) yield c;
  }

  /** @ignore */
  protected assertNotDisposed(): void {
    for (const c of this.chain()) {
      if (c.disposed) throw new IoCContainerDisposedError();
    }
  }

  /**

   * The nearest registration of `key` + `name`, if any.

   *

   * @ignore
   */
  protected find(key: IoCKey, name: string): IoCStored | undefined {
    for (const c of this.chain()) {
      const reg = c.registrations.get(key)?.get(name);

      if (reg) return reg;
    }

    return undefined;
  }

  /**

   * The nearest registration of `key` + `name`, or a not-found error.

   *

   * @ignore
   */
  protected lookup(key: IoCKey, name: string, frame: IoCResolveFrame | undefined): IoCStored {
    const reg = this.find(key, name);

    if (reg) return reg;

    const names = new Set<string>();

    for (const c of this.chain()) {
      for (const n of c.registrations.get(key)?.keys() ?? []) names.add(n);
    }

    throw new IoCServiceNotFoundError(
      keyDescription(key),
      name,
      [...names],
      framePath(frame),
      this.isExpected({ key, name })
        ? 'It is declared with Expect(); register it on the container or scope that provides it.'
        : undefined,
    );
  }

  /**

   * True when `dep` was declared with `Expect()` here or in a parent.

   *

   * @ignore
   */
  protected isExpected(dep: IoCDependencyRecord): boolean {
    for (const c of this.chain()) {
      if (c.expected.get(dep.key)?.has(dep.name)) return true;
    }

    return false;
  }

  /**

   * The registrations visible from here (nearest wins), with their depth.

   *

   * @ignore
   */
  protected visible(): { reg: IoCStored; depth: number }[] {
    const seen = new Set<string>();

    const keys = new Map<IoCKey, number>();

    const out: { reg: IoCStored; depth: number }[] = [];

    let depth = 0;

    for (const c of this.chain()) {
      for (const [key, bank] of c.registrations) {
        if (!keys.has(key)) keys.set(key, keys.size);

        for (const [name, reg] of bank) {
          const id = `${keys.get(key)}\u0000${name}`;

          if (seen.has(id)) continue;

          seen.add(id);

          out.push({ reg, depth });
        }
      }

      depth++;
    }

    return out;
  }

  /**

   * True when `module` was added here or in a parent.

   *

   * @ignore
   */
  protected hasModule(module: IoCModule): boolean {
    for (const c of this.chain()) {
      if (c.modules.includes(module)) return true;
    }

    return false;
  }

  /**

   * Stores a registration, applying the duplicate and default rules.

   *

   * @ignore
   */
  protected addRegistration(spec: IoCRegistrationSpec): void {
    this.assertNotDisposed();

    const key = checkKey(spec.key);

    const name = spec.name || DEFAULT_NAME;

    const label = labelFor(key, name);

    const { options } = spec;

    const existing = this.registrations.get(key)?.get(name);

    if (existing) {
      // A default yields to whatever is registered, unless that is a default too.
      if (options.Default && !existing.default) return;

      if (!options.Default && !options.Replace && !existing.default) {
        throw new IoCDuplicateRegistrationError(label);
      }
    } else if (options.Default) {
      // A default also yields to a parent's registration (a framework default in a scope).
      const inherited = this.parent?.find(key, name);

      if (inherited && !inherited.default) return;
    }

    const lifetime: IoCLifetime = spec.kind === 'value'
      ? 'singleton'
      : options.Lifetime ?? 'singleton';

    const value = spec.value;

    // A value belongs to whoever created it: nobody disposes it unless a Dispose option says how.
    if (value && !spec.dispose) {
      const v = value.value;

      if ((typeof v === 'object' || typeof v === 'function') && v !== null && !IOC_OWNERS.has(v)) {
        IOC_OWNERS.set(v, IOC_EXTERNAL);
      }
    }

    this.store({
      key,
      name,
      label,
      lifetime,
      kind: spec.kind,
      ctor: spec.ctor,
      deps: spec.deps,
      default: options.Default || undefined,
      factory: spec.factory as (ioc: unknown) => unknown,
      dispose: spec.dispose,
      holder: value
        ? { state: 'ready', value: value.value }
        : lifetime === 'singleton'
        ? { state: 'empty' }
        : undefined,
      owner: this,
    });

    if (value && spec.dispose) this.track(value.value, label, spec.dispose);
  }

  /** @ignore */
  protected store(reg: IoCStored): void {
    let bank = this.registrations.get(reg.key);

    if (!bank) this.registrations.set(reg.key, bank = new Map());

    bank.set(reg.name, reg);
  }

  /**

   * Resolves `reg` (found from this container) for the chain `frame`.

   *

   * @ignore
   */
  protected resolveIn(reg: IoCStored, frame: IoCResolveFrame | undefined): unknown {
    if (isOnPath(frame, reg)) {
      throw new IoCCircularDependencyError([...framePath(frame), reg.label]);
    }

    if (reg.lifetime === 'transient') return this.build(reg, frame);

    if (reg.lifetime === 'singleton') return reg.owner.fromHolder(reg.holder!, reg, frame);

    // Scoped: one instance per scope, built in (and disposed with) the scope.
    if (!this.parent) throw new IoCScopeRequiredError(reg.label);

    let holder = this.scopedHolders.get(reg);

    if (!holder) this.scopedHolders.set(reg, holder = { state: 'empty' });

    return this.fromHolder(holder, reg, frame);
  }

  /**

   * Returns `holder`'s instance, building it in this container when needed.

   *

   * @ignore
   */
  protected fromHolder(
    holder: IoCHolder,
    reg: IoCRegistration,
    frame: IoCResolveFrame | undefined,
  ): unknown {
    if (holder.state === 'ready') return holder.value;

    if (holder.state === 'pending') {
      // A synchronous factory reached itself again through a captured container.
      if (!holder.promise) throw new IoCCircularDependencyError([...framePath(frame), reg.label]);

      return holder.promise;
    }

    holder.state = 'pending';

    let result: unknown;

    try {
      result = this.build(reg, frame);
    } catch (err) {
      holder.state = 'empty';

      throw err;
    }

    const settle = (value: unknown) => {
      holder.state = 'ready';
      holder.value = value;
      holder.promise = undefined;

      this.track(value, reg.label, reg.dispose);

      return value;
    };

    if (!(result instanceof Promise)) return settle(result);

    holder.promise = result.then(settle, (err) => {
      // A failed build is retried on the next resolve.
      holder.state = 'empty';
      holder.promise = undefined;

      throw err;
    });

    return holder.promise;
  }

  /**

   * Runs `reg`'s factory as one step of the chain `frame`.

   *

   * @ignore
   */
  protected build(reg: IoCRegistration, frame: IoCResolveFrame | undefined): unknown {
    const step: IoCResolveFrame = { reg, parent: frame };

    // The factory gets a view of this container that carries its step of the chain, so what it
    // resolves through it is checked for cycles.
    const view = Object.create(this, { [IOC_FRAME]: { value: step } });

    const done = () => {
      step.settled = true;
    };

    let result: unknown;

    try {
      result = reg.factory(view);
    } catch (err) {
      done();

      throw err;
    }

    if (result instanceof Promise) result.then(done, done);
    else done();

    return result;
  }

  /**

   * Records an instance this container created, to dispose it with the container.

   *

   * @ignore
   */
  protected track(value: unknown, label: string, dispose?: (instance: unknown) => unknown): void {
    const isObject = (typeof value === 'object' || typeof value === 'function') && value !== null;

    // Only what has a Dispose option, or disposes itself, needs disposing.
    if (!dispose && !isDisposable(value)) return;

    if (isObject) {
      // An instance someone else already owns is theirs to dispose.
      if (IOC_OWNERS.has(value)) return;

      IOC_OWNERS.set(value, this);
    }

    const owned: IoCOwned = { value, label, dispose };

    if (this.disposed) {
      // Finished building after the container was disposed: dispose it now.
      void this.disposeEntry(owned).catch(noop);

      return;
    }

    this.owned.push(owned);

    this.retain();
  }

  /**

   * Makes the parent track this scope, once it owns something to dispose.

   *

   * @ignore
   */
  protected retain(): void {
    if (this.retained || !this.parent) return;

    this.retained = true;

    this.parent.children.add(this);

    this.parent.retain();
  }

  /**

   * Bounds `value` (when a promise) by `PendingTimeoutMs`.

   *

   * @ignore
   */
  protected timed<T>(value: T | Promise<T>, label: string): T | Promise<T> {
    const ms = this.options.PendingTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!ms || !(value instanceof Promise)) return value;

    let timer: unknown;

    const timeout = new Promise<never>((_, reject) => {
      timer = host.setTimeout(() => reject(new IoCResolveTimeoutError(label, ms)), ms);
    });

    return Promise.race([value, timeout]).finally(() => host.clearTimeout(timer));
  }

  /** @ignore */
  protected async startNow(options?: { Validate?: boolean }): Promise<void> {
    this.assertNotDisposed();

    this.state = 'starting';

    try {
      // A scope's module can't start before the parent modules it requires.
      for (const module of this.modules) {
        for (const required of module.Requires ?? []) {
          const owner = [...this.chain()].find((c) => c.modules.includes(required));

          if (owner && owner !== this && owner.state !== 'started') {
            throw new IoCStartError(
              module.Name,
              new Error(
                `it requires module '${required.Name}', which belongs to a parent container ` +
                  `that hasn't started; start the parent first`,
              ),
            );
          }
        }
      }

      if (options?.Validate !== false) this.Validate();
    } catch (err) {
      this.state = 'idle';

      throw err;
    }

    for (const module of this.modules) {
      if (this.started.includes(module)) continue;

      if (this.disposing) throw new IoCContainerDisposedError();

      try {
        await this.timed(module.OnStart?.(this), `Module '${module.Name}' OnStart`);
      } catch (err) {
        // Dispose() is running: it stops what started.
        if (this.disposing) throw new IoCStartError(module.Name, err);

        const rollback = await this.stopModules();

        this.state = 'idle';

        throw new IoCStartError(module.Name, err, rollback);
      }

      this.started.push(module);
    }

    if (this.disposing) throw new IoCContainerDisposedError();

    this.state = 'started';
  }

  /**
   * Stops the modules of this container's live scopes (deepest first: they may require this
   * container's modules), then its own.
   *
   * @ignore
   */
  protected async stopTree(): Promise<unknown[]> {
    await this.starting?.catch(noop);

    const errors: unknown[] = [];

    for (const scope of [...this.children].reverse()) errors.push(...await scope.stopTree());

    errors.push(...await this.stopModules());

    return errors;
  }

  /**

   * Runs `OnStop` of the started modules, in reverse; returns what failed.

   *

   * @ignore
   */
  protected async stopModules(): Promise<unknown[]> {
    const errors: unknown[] = [];

    for (const module of this.started.splice(0).reverse()) {
      try {
        await this.timed(module.OnStop?.(this), `Module '${module.Name}' OnStop`);
      } catch (err) {
        errors.push(err);
      }
    }

    return errors;
  }

  /** @ignore */
  protected async disposeEntry({ value, label, dispose }: IoCOwned): Promise<void> {
    await this.timed(dispose ? dispose(value) : disposeOne(value as object), `Disposing ${label}`);
  }

  /** @ignore */
  protected async disposeNow(): Promise<void> {
    this.state = 'stopping';

    // Modules stop while every service is still alive: the scopes' modules first (they may require
    // this container's), then this container's. A running Start() finishes its current module.
    const errors = await this.stopTree();

    // Then the scopes, each disposing its own scopes first, then this container's instances.
    for (const scope of [...this.children].reverse()) {
      try {
        await scope.Dispose();
      } catch (err) {
        errors.push(err);
      }
    }

    this.disposed = true;

    for (const entry of this.owned.splice(0).reverse()) {
      try {
        await this.disposeEntry(entry);
      } catch (err) {
        errors.push(err);
      }
    }

    this.state = 'disposed';

    this.parent?.children.delete(this);

    if (errors.length) throw new IoCDisposeError(errors);
  }

  //#endregion
}

/** Resolves dependencies through `ioc` (a factory's view, so the chain continues), in order. */
function resolveAll(ioc: IoCContainer, deps: IoCDependencyRecord[]): Promise<unknown[]> {
  return Promise.all(
    deps.map((d) => ioc.Resolve(d.key as IoCServiceKey<unknown>, d.name)),
  );
}
