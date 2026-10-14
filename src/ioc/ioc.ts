import {
  IoCActivationError,
  IoCCircularDependencyError,
  IoCContainerDisposedError,
  IoCDisposeError,
  IoCDuplicateRegistrationError,
  IoCKeyCollisionError,
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
  abandonedBy,
  activeHolders,
  type AnyFunction,
  attachBuild,
  constructorArity,
  createLegacyThunk,
  createThunk,
  createView,
  currentFrame,
  framePath,
  IOC_CONTEXT,
  IOC_EXTERNAL,
  IOC_OWNERS,
  IOC_PROTOCOL,
  IOC_PROTOCOL_VERSION,
  IOC_SELF,
  type IoCDependencyRecord,
  type IoCHolder,
  type IoCLifetime,
  type IoCRegistration,
  type IoCResolveFrame,
  isClassLike,
  isHolder,
  isOnActivePath,
  labelFor,
  nearestHolder,
  noop,
  registrationOf,
  releaseBuild,
  settleInto,
  waitPath,
  withFrame,
} from './internals.ts';
import type { IoCDependencyValue, IoCDependencyValues, IoCDerivedDependency } from './IoCDeps.ts';
import type { IoCModule } from './IoCModule.ts';
import type { IoCToken } from './IoCToken.ts';

/** A notice the container reports through the `Diagnostics` option; never thrown. */
export type IoCDiagnosticCode =
  | 'IOC_REGISTRATION_REPLACED'
  | 'IOC_CLASS_NAME_FALLBACK'
  | 'IOC_KEY_COLLISION'
  | 'IOC_LATE_DISPOSE_FAILED'
  | 'IOC_MODULE_DUPLICATE';

/** One diagnostic notice. */
export interface IoCDiagnostic {
  /** What happened. */
  Code: IoCDiagnosticCode;

  /** A readable description. */
  Message: string;

  /** The service involved, when there is one. */
  Service?: string;
}

/**
 * Options for a container. They are inherited by its scopes. A container created with no options
 * behaves exactly like earlier versions.
 */
export interface IoCContainerOptions {
  /**
   * Turns likely mistakes into errors:
   *
   * - registering a key and name again without `Replace: true` (or `Default: true`);
   * - resolving a `scoped` service outside a scope;
   * - a class key resolving a *different*, unregistered class that happens to share its name;
   * - a token and a class sharing one key.
   */
  Strict?: boolean;

  /** Build singletons and scoped services on first resolve unless a registration says `Lazy: false`. */
  LazyByDefault?: boolean;

  /** Receives notices about things that are allowed but often unintended (replaced registrations…). */
  Diagnostics?: (diagnostic: IoCDiagnostic) => void;

  /**
   * An `AsyncLocalStorage` (from `node:async_hooks`) the container may use to follow resolution
   * chains across `await` even when a factory resolves through a captured container instead of
   * its parameter. Without it, such resolves are invisible to cycle detection after the
   * factory's first `await`, and a cycle through them can wait forever. The container never
   * imports `node:async_hooks` itself, so browser bundles are unaffected.
   */
  AsyncContext?: IoCAsyncContext;

  /**
   * Fails a `Resolve` that is still pending after this many milliseconds with an
   * `IoCResolveTimeoutError` that lists what it is waiting on, instead of waiting forever (a
   * hung factory, or a cycle through a captured container). Off by default.
   */
  PendingTimeoutMs?: number;
}

/** The part of `AsyncLocalStorage` the `AsyncContext` option uses. */
export interface IoCAsyncContext {
  /** The value stored for the running async context. */
  getStore(): unknown;

  /** Runs `fn` with `store` as the async context's value. */
  // deno-lint-ignore no-explicit-any
  run<R>(store: any, fn: () => R): R;
}

/** One registration, as reported by {@link IoCContainer.Describe}. */
export interface IoCServiceDescription {
  /** The key's id (the token id, class name or symbol description). */
  Key: string;

  /** The registration name (`$default` when unnamed). */
  Name: string;

  /** `Key` or `Key[name]`, as used in error messages. */
  Label: string;

  /** How it was registered; `external` for entries this version didn't create (older versions). */
  Kind: 'class' | 'factory' | 'value' | 'external';

  /** The lifetime, when known. */
  Lifetime?: 'singleton' | 'transient' | 'scoped';

  /** For level-bound scoped services: the level. */
  ScopeLevel?: string;

  /** Registered with `Default: true`. */
  Default: boolean;

  /** The module that registered it (`Use`), if any. */
  Module?: string;

  /** 0 for this container, 1 for its parent, and so on. */
  Depth: number;

  /** True when a nearer container registers the same key and name, so this one isn't used here. */
  Shadowed: boolean;

  /** Declared dependencies (`Deps`), as labels; `IoCLazy`/`IoCAll` are marked `lazy:`/`all:`. */
  Deps: string[];

  /** What the factory resolved the last times it ran (labels), for factories without `Deps`. */
  Observed: string[];

  /** For singletons, and scoped services in this scope: whether the instance is built. */
  State?: 'empty' | 'pending' | 'ready';
}

/** What {@link IoCContainer.Describe} returns. */
export interface IoCDescription {
  /** This container's scope level, if it is a scope created with one. */
  Level?: string;

  /** True for a scope (a container with a parent). */
  Scope: boolean;

  /** Every registration visible from this container, nearest first. */
  Services: IoCServiceDescription[];

  /** The modules added here and in parents, in the order they were added. */
  Modules: { Name: string; Requires: string[]; Started: boolean; Depth: number }[];
}

/** Any constructed service value. */
// deno-lint-ignore ban-types
export type IoCServiceConstructed = { constructor: Function };

/** A class that can be registered and used as a resolution key. */
// deno-lint-ignore no-explicit-any
export type IoCServiceConstructor<T> = { new (...args: any[]): T };

/**
 * A class used only as a key (it is never constructed by the container), so abstract classes
 * work as typed "interface" keys: `ioc.RegisterFactory(Repo, () => new PgRepo())`.
 */
// deno-lint-ignore no-explicit-any
export type IoCServiceKeyConstructor<T> = abstract new (...args: any[]) => T;

/** Anything a service can be resolved by with its type known: a typed token, or a class. */
export type IoCServiceKey<T> = IoCToken<T> | IoCServiceKeyConstructor<T>;

/** The service type a key resolves to: the token's type, the class's instance, else `unknown`. */
export type IoCServiceOf<TKey> = TKey extends IoCToken<infer T, string> ? T
  : TKey extends IoCServiceKeyConstructor<infer T> ? T
  : unknown;

/** Options accepted by {@link IoCContainer.Register}. */
export type IoCServiceOptions = {
  /**
   * Defer creating a singleton or scoped service until it is first resolved. The created
   * instance is then memoized; a failed creation is retried on the next resolve.
   */
  Lazy?: boolean;

  /**
   * `singleton` (default): one shared instance. `transient`: a new instance per resolve.
   * `scoped`: one instance per scope (see {@link IoCContainer.CreateScope}); in the container it
   * was registered in it behaves as a singleton whose registration can be removed with the
   * function `Register` returns.
   */
  Lifetime?: 'transient' | 'scoped';

  /** Registers under a name, so several services can share one type (`$default` when omitted). */
  Name?: string;

  /** The symbol to register under. Defaults to `Symbol.for(clazz.name)` for class registrations. */
  Type?: symbol;

  /**
   * Registers a default that yields to any other registration of the same key and name, whatever
   * the order: if one exists (here or in a parent) this call does nothing, and a later registration
   * replaces it silently, even in strict mode. Frameworks use it for overridable services.
   * Defaults are always lazy, so an overridden default is never built.
   */
  Default?: boolean;

  /** Replaces an existing registration on purpose. Required in strict mode; otherwise optional. */
  Replace?: boolean;

  /**
   * For `Lifetime: 'scoped'`: the scope level the instance lives in. It is created in (and
   * disposed with) the nearest scope created with `CreateScope({ Level })` of this level, so
   * every request scope inside one tenant scope shares the tenant's instance. Resolving it with
   * no such scope above throws `IoCScopeRequiredError`. Without it, a scoped instance lives in
   * the scope it is resolved from.
   */
  ScopeLevel?: string;
};

/** A dependency key: a typed token, or a class (abstract classes included). */
export type IoCDependencyKey<T> = IoCToken<T> | IoCServiceKeyConstructor<T>;

/** A declared dependency: a key, or `[key, name]` for a named registration. */
export type IoCDependency<T> = IoCDependencyKey<T> | readonly [IoCDependencyKey<T>, string];

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
  readonly [K in keyof P]:
    | (IoCDependency<P[K]> & IoCAllowedKeys<TKeys>)
    | IoCDerivedDependency<P[K]>;
};

/**
 * A dependency a factory may declare in `Deps`: on a typed container, a key registered so far;
 * or a derived dependency (`IoCLazy`, `IoCAll`).
 */
// deno-lint-ignore no-explicit-any
export type IoCFactoryDependency<TKeys = any> =
  // deno-lint-ignore no-explicit-any
  | (IoCDependency<any> & IoCAllowedKeys<TKeys>)
  // deno-lint-ignore no-explicit-any
  | IoCDerivedDependency<any>;

/**
 * What a registration adds to a typed container's registry: the key itself for the default name,
 * or `[key, name]` for a named registration. Plain symbols add nothing (they carry no type).
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
 * instances satisfy, or a plain symbol.
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
  TType extends symbol = symbol,
> =
  & Omit<IoCServiceOptions, 'Name' | 'Type'>
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
     * The key to register under, instead of the class: a token whose type the class satisfies
     * (`RegisterClass(PgDb, { Type: $Db })`), or a symbol.
     */
    Type?: IoCTypeFor<InstanceType<C>, TType>;

    /** Cleans up the instance when its owner is disposed (instead of `Symbol.asyncDispose`). */
    Dispose?: (instance: InstanceType<C>) => unknown;
  };

/** Options for registrations whose key is given separately (no `Type`). */
export type IoCRegisterOptions<TName extends string = string, T = unknown> =
  & Omit<IoCServiceOptions, 'Name' | 'Type'>
  & {
    /** Registers under a name, so several services can share one key (`$default` when omitted). */
    Name?: TName;

    /**
     * Cleans up the instance when the container (or scope) that owns it is disposed, for
     * resources that don't implement `Symbol.asyncDispose` / `Symbol.dispose` (`kv => kv.close()`).
     */
    Dispose?: (instance: T) => unknown;
  };

/** What is stored per registration in {@link IoCContainer.services}. */
export type IoCServiceResolutions =
  | IoCServiceConstructed
  | Promise<IoCServiceConstructed>
  | (() => IoCServiceConstructed | Promise<IoCServiceConstructed>);

/** A factory: receives the container and returns the service (or a promise of it). */
export type IoCServiceResolver<T> = (ioc: IoCContainer) => T | Promise<T>;

/** Registrations by symbol, then by name. */
export type IoCServices = Map<symbol, Map<string, IoCServiceResolutions>>;

// deno-lint-ignore no-explicit-any
type Indexable = any;

type FoundEntry = { entry: unknown };

const DEFAULT_NAME = '$default';

// Timers exist in every supported runtime, but not in the plain ES lib the npm build compiles with.
const timers = globalThis as unknown as {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};

function keySymbol(key: AnyFunction | symbol): symbol {
  if (typeof key === 'symbol') return key;

  if (typeof key !== 'function') {
    throw new IoCRegistrationError(
      `Keys must be typed tokens, symbols or classes, but a ${typeof key} was given. ` +
        `Use IoCToken('Name') or ioc.Symbol('Name') instead of a string.`,
      'IOC_INVALID_KEY',
    );
  }

  return Symbol.for(key.name);
}

function normalizeDependency(dep: unknown): IoCDependencyRecord {
  const mode = (dep as Indexable)?.['@fathym/ioc/derived'] as IoCDependencyRecord['mode'];

  if (mode) return { ...normalizeDependency((dep as Indexable).Dependency), mode };

  if (Array.isArray(dep)) {
    return { key: dep[0] as AnyFunction | symbol, name: (dep[1] as string) || DEFAULT_NAME };
  }

  return { key: dep as AnyFunction | symbol, name: DEFAULT_NAME };
}

/** Records that the factory running in `frame` resolved `key` + `name` (see `observed`). */
function observe(
  frame: IoCResolveFrame | undefined,
  key: AnyFunction | symbol,
  name: string,
): void {
  const observed = frame && !frame.settled ? frame.reg?.observed : undefined;

  if (!observed) return;

  const label = labelFor(keySymbol(key), name);

  if (!observed.has(label)) observed.set(label, { key, name });
}

/** The labels of the pending builds `holder` is (transitively) waiting on, itself first. */
function pendingLabels(holder: IoCHolder | undefined): string[] {
  const labels: string[] = [];

  const seen = new Set<IoCHolder>();

  const visit = (h: IoCHolder) => {
    if (seen.has(h) || h.state !== 'pending') return;

    seen.add(h);

    if (h.building) labels.push(h.building.label);

    for (const next of h.waits ?? []) visit(next);

    for (const child of h.children ?? []) visit(child);
  };

  if (holder) visit(holder);

  return labels;
}

/** Produces what a dependency injects: the service, a resolver function, or every registration. */
function resolveDependency(ioc: IoCContainer, dep: IoCDependencyRecord): unknown {
  if (dep.mode === 'lazy') return () => ioc.Resolve(dep.key as symbol, dep.name);

  if (dep.mode === 'all') return ioc.ResolveAll(dep.key as symbol);

  return ioc.Resolve(dep.key as symbol, dep.name);
}

function dependencyLabel(dep: IoCDependencyRecord): string {
  return labelFor(keySymbol(dep.key), dep.name);
}

/** True for two copies of one class (for example from two copies of a package). */
function sameSource(a: AnyFunction, b: AnyFunction): boolean {
  try {
    return Function.prototype.toString.call(a) === Function.prototype.toString.call(b);
  } catch {
    return false;
  }
}

/** Disposes one instance through `Symbol.asyncDispose` or `Symbol.dispose`. */
async function disposeOne(value: object): Promise<void> {
  const v = value as Indexable;

  if (typeof v[Symbol.asyncDispose] === 'function') {
    await v[Symbol.asyncDispose]();
  } else if (typeof v[Symbol.dispose] === 'function') {
    v[Symbol.dispose]();
  }
}

function isDisposable(value: unknown): value is object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;

  return typeof (value as Indexable)[Symbol.asyncDispose] === 'function' ||
    typeof (value as Indexable)[Symbol.dispose] === 'function';
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
 * const ioc = new IoCContainer();
 *
 * ioc.RegisterValue($DbUrl, 'kv://local');
 * ioc.RegisterClass(Repo, { Deps: [$DbUrl] });
 *
 * const repo = await ioc.Resolve(Repo);
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
 * const repo = await ioc.Resolve(Repo);
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

  /** Registrations by symbol, then by name (this container's own; scopes see parents too). */
  public services: IoCServices;

  /** Symbols handed out by {@link IoCContainer.Symbol}. */
  public symbols: Map<string, symbol>;

  /**
   * Registrations keyed by their exact class, so two different classes that share a name do not
   * resolve each other's instances. The name-based bank in `services` stays authoritative for
   * symbol lookups and for classes the container has not seen.
   *
   * @ignore
   */
  protected readonly byCtor: Map<AnyFunction, Map<string, unknown>>;

  /**
   * The container this scope was created from (see {@link IoCContainer.CreateScope}).
   *
   * @ignore
   */
  protected parent?: IoCContainer;

  /**
   * This scope's instances of `scoped` registrations owned by an ancestor.
   *
   * @ignore
   */
  protected readonly scopedHolders: Map<IoCRegistration, IoCHolder>;

  /**
   * Instances this container created and must dispose, in creation order.
   *
   * @ignore
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Port = IoCToken<number>('Port');
   *
   * const ioc = new IoCContainer();
   *
   * ioc.RegisterValue($Port, 8080);
   *
   * const port = await ioc.Resolve($Port); // number
   * ```
   */
  protected readonly owned: object[];

  /**
   * Keys declared with {@link IoCContainer.Expect}: provided elsewhere (often by each scope), so
   * `Validate()` doesn't report them as missing. Symbol, then names.
   *
   * @ignore
   */
  protected readonly expected: Map<symbol, Set<string>>;

  /** @ignore */
  protected disposed: boolean;

  /**
   * The options this container was created with (scopes inherit their parent's).
   *
   * @ignore
   */
  protected readonly options: IoCContainerOptions;

  /**
   * The modules added with `Use()`, in the order they were registered.
   *
   * @ignore
   */
  protected readonly modules: IoCModule[];

  /**
   * The modules whose `OnStart` ran (or that have none), in start order; stopped in reverse.
   *
   * @ignore
   */
  protected readonly started: IoCModule[];

  /**
   * The module whose `Register` is running, so its registrations are recorded as its own.
   *
   * @ignore
   */
  protected applying?: string;

  /**
   * Which module made each registration (by symbol, then name).
   *
   * @ignore
   */
  protected readonly origins: Map<symbol, Map<string, string>>;

  /**
   * The running or finished `Start()`.
   *
   * @ignore
   */
  protected starting?: Promise<void>;

  /**
   * The running `Dispose()`.
   *
   * @ignore
   */
  protected disposing?: Promise<void>;

  /**
   * The level given to `CreateScope({ Level })`, if any.
   *
   * @ignore
   */
  protected level?: string;

  /**
   * Creates a container. With no options it behaves exactly like earlier versions; see
   * {@link IoCContainer.Create} for the recommended settings for new code.
   *
   * @param options Strictness, lazy-by-default, and a diagnostics callback.
   */
  constructor(options?: IoCContainerOptions) {
    this.options = { ...options };

    this.services = new Map<symbol, Map<string, IoCServiceResolutions>>();

    this.symbols = new Map<string, symbol>();

    this.byCtor = new Map();

    this.scopedHolders = new Map();

    this.owned = [];

    this.expected = new Map();

    this.modules = [];

    this.started = [];

    this.origins = new Map();

    this.disposed = false;

    Object.defineProperty(this, IOC_PROTOCOL, { value: IOC_PROTOCOL_VERSION });
  }

  /**
   * Creates a container with the settings recommended for new code: `Strict` (likely mistakes
   * become errors) and `LazyByDefault` (nothing is built until it is first needed; call
   * `Activate()` at startup to fail fast).
   *
   * @example
   * ```ts
   * import { IoCContainer } from '@fathym/ioc';
   *
   * class Clock {}
   *
   * const ioc = IoCContainer.Create().RegisterClass(Clock);
   *
   * await ioc.Activate(); // builds Clock now
   * ```
   */
  public static Create(options?: IoCContainerOptions): IoCContainer {
    return new IoCContainer({ Strict: true, LazyByDefault: true, ...options });
  }

  //#region Resolution

  /** Resolves a service by typed token, optionally by name. */
  public async Resolve<T>(token: IoCToken<T>, name?: string): Promise<T>;

  /** Resolves a service by class (abstract classes work as keys), optionally by name. */
  public async Resolve<T>(ctor: IoCServiceKeyConstructor<T>, name?: string): Promise<T>;

  /** Resolves a service by plain symbol (`Resolve<Db>(ioc.Symbol('Db'))`), optionally by name. */
  public async Resolve<T>(symbol: symbol, name?: string): Promise<T>;

  public async Resolve<T>(
    ctorSymbol: IoCServiceKeyConstructor<T> | symbol,
    name?: string,
  ): Promise<T> {
    const frame = this.frame();

    this.assertNotDisposed();

    const entry = this.lookup(ctorSymbol, name ?? DEFAULT_NAME, frame);

    observe(frame, ctorSymbol, name ?? DEFAULT_NAME);

    return (await this.limit(this.realize(entry, frame), entry, ctorSymbol, name)) as T;
  }

  /** Resolves a service, or `undefined` when nothing is registered for it. */
  public async TryResolve<T>(
    key: IoCServiceKey<T> | symbol,
    name?: string,
  ): Promise<T | undefined> {
    const frame = this.frame();

    this.assertNotDisposed();

    const found = this.find(key, name ?? DEFAULT_NAME);

    if (found) observe(frame, key, name ?? DEFAULT_NAME);

    return found
      ? (await this.limit(this.realize(found.entry, frame), found.entry, key, name)) as T
      : undefined;
  }

  /**
   * Resolves every named registration for a key (including `$default`), nearest scope first
   * when a name is registered at several levels.
   */
  public async ResolveAll<T>(key: IoCServiceKey<T> | symbol): Promise<T[]> {
    const names: string[] = [];

    for (const container of this.chain()) {
      const bank = container.services.get(keySymbol(key));

      for (const name of bank?.keys() ?? []) {
        if (!names.includes(name)) names.push(name);
      }
    }

    // Resolve through `this` so a factory parameter view keeps its resolution chain.
    return await Promise.all(names.map((name) => this.Resolve(key as symbol, name) as Promise<T>));
  }

  /**
   * Resolves every registration of a key into a `Map` from name to service (`$default`
   * included), nearest scope first. The container-backed replacement for hand-built
   * string-keyed registries.
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * interface Profile {
   *   model: string;
   * }
   *
   * const $Profile = IoCToken<Profile, 'Profile'>('Profile');
   *
   * const ioc = new IoCContainer()
   *   .RegisterValue($Profile, { model: 'small' }, { Name: 'fast' })
   *   .RegisterValue($Profile, { model: 'large' }, { Name: 'smart' });
   *
   * const profiles = await ioc.ResolveNamed($Profile);
   *
   * console.log(profiles.get('smart')?.model); // large
   * ```
   */
  public async ResolveNamed<T>(key: IoCServiceKey<T> | symbol): Promise<Map<string, T>> {
    const names = this.Names(key);

    // Resolve through `this` so a factory parameter view keeps its resolution chain.
    const values = await Promise.all(
      names.map((name) => this.Resolve(key as symbol, name) as Promise<T>),
    );

    return new Map(names.map((name, i) => [name, values[i]]));
  }

  /**
   * Resolves several services at once into an object with the same keys, each typed from its
   * key: `const { db, cache } = await ioc.ResolveRecord({ db: $Db, cache: [Kv, 'cache'] })`.
   * Values may also be `IoCLazy(…)` or `IoCAll(…)`. Everything resolves concurrently.
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Url = IoCToken<string, 'RecordUrl'>('RecordUrl');
   * const $Port = IoCToken<number, 'RecordPort'>('RecordPort');
   *
   * const ioc = new IoCContainer()
   *   .RegisterValue($Url, 'localhost')
   *   .RegisterValue($Port, 8080, { Name: 'http' });
   *
   * const { url, port } = await ioc.ResolveRecord({ url: $Url, port: [$Port, 'http'] });
   *
   * console.log(`${url}:${port}`); // localhost:8080
   * ```
   */
  public async ResolveRecord<
    // deno-lint-ignore no-explicit-any
    const R extends Record<string, IoCDependency<any> | IoCDerivedDependency<any>>,
  >(record: R): Promise<{ -readonly [K in keyof R]: IoCDependencyValue<R[K]> }> {
    const entries = Object.entries(record);

    const values = await Promise.all(
      entries.map(([, dep]) => resolveDependency(this, normalizeDependency(dep))),
    );

    return Object.fromEntries(entries.map(([k], i) => [k, values[i]])) as {
      -readonly [K in keyof R]: IoCDependencyValue<R[K]>;
    };
  }

  /**
   * The names registered for a key (including `$default`), nearest scope first, without building
   * anything. Useful for plugin registries keyed by name.
   */
  public Names(key: IoCServiceKey<unknown> | symbol): string[] {
    const names: string[] = [];

    const symbol = keySymbol(key);

    for (const container of this.chain()) {
      for (const name of container.services.get(symbol)?.keys() ?? []) {
        if (!names.includes(name)) names.push(name);
      }
    }

    return names;
  }

  /** True when a registration exists for the key and name (in this container or its parents). */
  public Has(key: IoCServiceKey<unknown> | symbol, name?: string): boolean {
    return !!this.find(key, name ?? DEFAULT_NAME);
  }

  /**
   * Returns the raw stored entry for a registration without creating anything. Prefer
   * {@link IoCContainer.Resolve}; this exists for container-to-container copying.
   */
  public ResolveDirect<T>(
    ctorSymbol: IoCServiceKeyConstructor<T> | symbol,
    name?: string,
  ): IoCServiceResolutions {
    return this.lookup(ctorSymbol, name ?? DEFAULT_NAME, this.frame()) as IoCServiceResolutions;
  }

  /**
   * Creates every singleton registered in this container that has not been created yet (lazy or
   * failed ones), so configuration errors surface at startup rather than on first use. Rejects
   * with an `AggregateError` naming every service that failed. Transient and scoped services are
   * not built: they belong to each resolve and to each scope.
   *
   * @example Fail fast at startup
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const ioc = new IoCContainer();
   *
   * ioc.RegisterFactory(IoCToken('Cache'), () => new Map(), { Lazy: true });
   *
   * await ioc.Activate(); // builds Cache now; throws an AggregateError naming every failure
   * ```
   */
  public async Activate(): Promise<void> {
    const self = this.self();

    self.assertNotDisposed();

    const failures: { label: string; error: unknown }[] = [];

    const work: Promise<void>[] = [];

    for (const bank of self.services.values()) {
      for (const entry of bank.values()) {
        const reg = registrationOf(entry);

        // Transients are built per resolve, and scoped services belong to the scopes that use them.
        if (!reg || reg.lifetime !== 'singleton') continue;

        work.push(
          Promise.resolve()
            .then(() => self.realize(entry, undefined))
            .then(noop, (error) => {
              failures.push({ label: reg.label, error });
            }),
        );
      }
    }

    await Promise.all(work);

    if (failures.length) {
      throw new IoCActivationError(
        failures.map((f) => f.error),
        failures.map((f) => f.label),
      );
    }
  }

  /**
   * Checks the registrations visible from this container and throws an
   * {@link IoCValidationError} listing every problem found:
   *
   * - a declared dependency (`RegisterClass(…, { Deps })`) that is not registered;
   * - a cycle between declared dependencies;
   * - a singleton that declares a `scoped` dependency (it would capture one instance forever);
   * - a class registered without a factory or `Deps` whose constructor takes parameters (it
   *   would be constructed with `undefined` arguments).
   *
   * Keys declared with {@link IoCContainer.Expect} count as provided. Factories are opaque, so
   * dependencies resolved inside them are not checked; `Activate()` covers those by building
   * everything. Pass `{ Throw: false }` to get the issues back instead of an error.
   *
   * @example
   * ```ts
   * import { IoCContainer } from '@fathym/ioc';
   *
   * class Config {}
   *
   * class Repo {
   *   constructor(public config: Config) {}
   * }
   *
   * const ioc = new IoCContainer();
   *
   * ioc.RegisterClass(Config);
   * ioc.RegisterClass(Repo, { Deps: [Config], Lazy: true });
   *
   * ioc.Validate(); // throws IoCValidationError if anything is missing, cyclic or captive
   * ```
   */
  public Validate(options?: { Throw?: boolean }): IoCValidationIssue[] {
    const issues: IoCValidationIssue[] = [];

    const issue = (kind: IoCValidationIssue['Kind'], service: string, message: string) => {
      issues.push({ Kind: kind, Service: service, Message: message });
    };

    const seen = new Set<IoCRegistration>();

    const registrations: IoCRegistration[] = [];

    for (const container of this.chain()) {
      for (const bank of container.services.values()) {
        for (const entry of bank.values()) {
          const reg = registrationOf(entry);

          if (reg && !seen.has(reg)) {
            seen.add(reg);
            registrations.push(reg);
          }
        }
      }

      for (const entries of container.byCtor.values()) {
        for (const entry of entries.values()) {
          const reg = registrationOf(entry);

          if (reg && !seen.has(reg)) {
            seen.add(reg);
            registrations.push(reg);
          }
        }
      }
    }

    const resolveDep = (dep: IoCDependencyRecord) => {
      const found = this.find(dep.key, dep.name);

      return found ? registrationOf(found.entry) : undefined;
    };

    for (const reg of registrations) {
      const arity = reg.kind === 'class' && !reg.deps && reg.ctor ? constructorArity(reg.ctor) : 0;

      if (arity > 0) {
        issue(
          'arguments',
          reg.label,
          `${reg.label} is constructed without arguments, but its constructor declares ` +
            `${arity} parameter(s); register it with a factory or with Deps.`,
        );
      }

      for (const dep of reg.deps ?? []) {
        // Every registration of a key, possibly none: nothing to be missing or captured.
        if (dep.mode === 'all') continue;

        if (!this.find(dep.key, dep.name)) {
          if (this.isExpected(keySymbol(dep.key), dep.name)) continue;

          issue(
            'missing',
            reg.label,
            `${reg.label} depends on ${dependencyLabel(dep)}, which is not registered.`,
          );
          continue;
        }

        const depReg = resolveDep(dep);

        if (reg.lifetime === 'singleton' && depReg?.lifetime === 'scoped') {
          issue(
            'captive',
            reg.label,
            `Singleton ${reg.label} depends on scoped ${depReg.label}; it would capture a ` +
              `single instance. Make ${reg.label} scoped or transient.`,
          );
        }
      }
    }

    // Cycles through declared dependencies (depth-first, reporting each cycle once).
    const state = new Map<IoCRegistration, 'visiting' | 'done'>();

    const reported = new Set<string>();

    const visit = (reg: IoCRegistration, path: IoCRegistration[]) => {
      if (state.get(reg) === 'done') return;

      if (state.get(reg) === 'visiting') {
        const cycle = [...path.slice(path.indexOf(reg)), reg].map((r) => r.label);

        const key = [...cycle].sort().join('|');

        if (!reported.has(key)) {
          reported.add(key);
          issue('cycle', reg.label, `Circular dependency: ${cycle.join(' -> ')}.`);
        }

        return;
      }

      state.set(reg, 'visiting');

      for (const dep of reg.deps ?? []) {
        // Lazy dependencies are resolved after construction, so they can't deadlock it.
        if (dep.mode) continue;

        const depReg = resolveDep(dep);

        if (depReg) visit(depReg, [...path, reg]);
      }

      state.set(reg, 'done');
    };

    for (const reg of registrations) visit(reg, []);

    if (issues.length && options?.Throw !== false) throw new IoCValidationError(issues);

    return issues;
  }

  //#endregion

  //#region Registration

  // Overload order matters for typing the factory parameter (`(ioc) => …`): the key + factory
  // forms come first, and the class-only and factory-only forms share one union signature,
  // because TypeScript does not contextually type a callback across separate overloads.

  /**
   * Registers a scoped factory under a token or symbol; returns a function that removes the
   * registration.
   *
   * @deprecated Use the explicit methods: {@link IoCContainer.RegisterClass},
   * {@link IoCContainer.RegisterFactory} or {@link IoCContainer.RegisterValue}. They never guess
   * whether you passed a class or a factory, and they chain on a typed container. `Register`
   * keeps working and will be removed in 1.0.
   */
  public Register<T>(
    type: IoCToken<T> | symbol,
    instance: IoCServiceResolver<NoInfer<T>>,
    options: IoCRegisterOptions & { Lifetime: 'scoped' },
  ): () => void;

  /**
   * Registers a factory under a token or symbol (same as passing `{ Type: type }`).
   *
   * @deprecated Use the explicit methods: {@link IoCContainer.RegisterClass},
   * {@link IoCContainer.RegisterFactory} or {@link IoCContainer.RegisterValue}. They never guess
   * whether you passed a class or a factory, and they chain on a typed container. `Register`
   * keeps working and will be removed in 1.0.
   */
  public Register<T>(
    type: IoCToken<T> | symbol,
    instance: IoCServiceResolver<NoInfer<T>>,
    options?: IoCRegisterOptions,
  ): void | (() => void);

  /**
   * Registers `clazz` as a scoped service created by `instance`; returns a function that removes
   * the registration.
   *
   * @deprecated Use the explicit methods: {@link IoCContainer.RegisterClass},
   * {@link IoCContainer.RegisterFactory} or {@link IoCContainer.RegisterValue}. They never guess
   * whether you passed a class or a factory, and they chain on a typed container. `Register`
   * keeps working and will be removed in 1.0.
   */
  public Register<T>(
    clazz: IoCServiceKeyConstructor<T>,
    instance: IoCServiceResolver<T>,
    options: IoCServiceOptions & { Lifetime: 'scoped' },
  ): () => void;

  /**
   * Registers a factory keyed by `clazz` (or `options.Type`).
   *
   * @deprecated Use the explicit methods: {@link IoCContainer.RegisterClass},
   * {@link IoCContainer.RegisterFactory} or {@link IoCContainer.RegisterValue}. They never guess
   * whether you passed a class or a factory, and they chain on a typed container. `Register`
   * keeps working and will be removed in 1.0.
   */
  public Register<T>(
    clazz: IoCServiceKeyConstructor<T>,
    instance: IoCServiceResolver<T>,
    options?: IoCServiceOptions,
  ): void | (() => void);

  /**
   * Registers a scoped class, or a scoped factory (`options.Type` is required for factories);
   * returns a function that removes the registration.
   *
   * @deprecated Use the explicit methods: {@link IoCContainer.RegisterClass},
   * {@link IoCContainer.RegisterFactory} or {@link IoCContainer.RegisterValue}. They never guess
   * whether you passed a class or a factory, and they chain on a typed container. `Register`
   * keeps working and will be removed in 1.0.
   */
  public Register<T>(
    clazzInstance: IoCServiceConstructor<T> | IoCServiceResolver<T>,
    options: IoCServiceOptions & { Lifetime: 'scoped' },
  ): () => void;

  /**
   * Registers a class (keyed by the class, or `options.Type`), or a factory (`options.Type` is
   * required).
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Db = IoCToken<{ url: string }>('Db');
   *
   * class Clock {}
   *
   * const ioc = new IoCContainer();
   *
   * ioc.Register(Clock); // a class (singleton by default)
   * ioc.Register($Db, async () => ({ url: 'kv://local' }), { Lazy: true }); // an async factory
   * ```
   *
   * @deprecated Use the explicit methods: {@link IoCContainer.RegisterClass},
   * {@link IoCContainer.RegisterFactory} or {@link IoCContainer.RegisterValue}. They never guess
   * whether you passed a class or a factory, and they chain on a typed container. `Register`
   * keeps working and will be removed in 1.0.
   */
  public Register<T>(
    clazzInstance: IoCServiceConstructor<T> | IoCServiceResolver<T>,
    options?: IoCServiceOptions,
  ): void | (() => void);

  public Register<T>(
    clazzInstance: IoCServiceKeyConstructor<T> | IoCServiceResolver<T> | symbol,
    instanceOptions?: IoCServiceResolver<T> | IoCServiceOptions,
    options?: IoCServiceOptions,
  ): void | (() => void) {
    let clazz: AnyFunction | undefined;
    let factory: (ioc: IoCContainer) => unknown;
    let opts: IoCServiceOptions;
    let kind: IoCRegistration['kind'] = 'factory';

    if (typeof clazzInstance === 'symbol') {
      if (typeof instanceOptions !== 'function') {
        throw new IoCRegistrationError(`A factory is required when registering by symbol.`);
      }

      factory = instanceOptions as IoCServiceResolver<T>;
      opts = { ...options, Type: clazzInstance };
    } else if (isClassLike(clazzInstance)) {
      clazz = clazzInstance;

      if (typeof instanceOptions === 'function') {
        factory = instanceOptions as IoCServiceResolver<T>;
        opts = { ...options };
      } else {
        const ctor = clazzInstance as unknown as IoCServiceConstructor<T>;
        factory = () => new ctor();
        opts = { ...(instanceOptions as IoCServiceOptions | undefined) };
        kind = 'class';
      }
    } else {
      factory = clazzInstance as IoCServiceResolver<T>;
      opts = { ...(instanceOptions as IoCServiceOptions | undefined) };
    }

    if (!opts.Type && clazz?.name) {
      opts.Type = Symbol.for(clazz.name);
    }

    if (!opts.Type) {
      throw new IoCRegistrationError(`The Type was missing for the registration.`);
    }

    const lifetime = opts.Lifetime ?? 'singleton';

    const unregister = this.addRegistration({
      symbol: opts.Type,
      name: opts.Name || DEFAULT_NAME,
      lifetime,
      kind,
      ctor: clazz && opts.Type === Symbol.for(clazz.name) ? clazz : undefined,
      factory,
      lazy: this.lazyFor(opts.Lazy),
      default: opts.Default,
      replace: opts.Replace,
      scopeLevel: opts.ScopeLevel,
    });

    // Historically only scoped registrations return their disposer.
    return lifetime === 'scoped' ? unregister : undefined;
  }

  /**
   * Starts typing this container's registrations: the container returned (the same object) only
   * lets `Deps` name keys registered (or {@link IoCContainer.Expect expected}) earlier in the
   * chain. Chain the registrations, because a statement on its own can't change a variable's type:
   * `const ioc = new IoCContainer().Typed().RegisterClass(Config).RegisterClass(Repo, …)`.
   *
   * @example Dependencies must be registered first
   * ```ts
   * import { IoCContainer } from '@fathym/ioc';
   *
   * class Config {
   *   public url = 'kv://local';
   * }
   *
   * class Repo {
   *   constructor(public config: Config) {}
   * }
   *
   * const ioc = new IoCContainer()
   *   .Typed()
   *   .RegisterClass(Config)
   *   .RegisterClass(Repo, { Deps: [Config] }); // Config is registered above, so this compiles
   *
   * const repo = await ioc.Resolve(Repo);
   * ```
   */
  public Typed(): IoCContainer<IoCNoKeys> {
    return this as unknown as IoCContainer<IoCNoKeys>;
  }

  /**
   * Declares keys that are registered somewhere else (another module, a parent container, or each
   * scope, like a per-request `$Request`), so a typed container's `Deps` may name them and
   * `Validate()` doesn't report them as missing. Nothing is registered: resolving an expected key
   * where nobody registered it still throws, with a hint. Returns the same container.
   *
   * @example A module that needs keys registered by another module
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Request = IoCToken<Request, 'Request'>('Request');
   *
   * class Handler {
   *   constructor(public req: Request) {}
   * }
   *
   * const ioc = new IoCContainer()
   *   .Typed()
   *   .Expect($Request) // registered on each request scope
   *   .RegisterClass(Handler, { Deps: [$Request], Lifetime: 'scoped', Lazy: true });
   *
   * await using scope = ioc.CreateScope();
   *
   * scope.RegisterValue($Request, new Request('http://localhost/'));
   *
   * console.log((await scope.Resolve(Handler)).req.url); // http://localhost/
   * ```
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

      const symbol = keySymbol(key);

      let names = self.expected.get(symbol);

      if (!names) {
        names = new Set();
        self.expected.set(symbol, names);
      }

      names.add(name);
    }

    return this as unknown as IoCContainer<TKeys | IoCExpected<TDeps>>;
  }

  /**
   * Registers a class that the container constructs (`new clazz(...deps)`), keyed by the class
   * (or `options.Type`). Returns the container, typed with the new key, so registrations chain.
   * Remove a registration with {@link IoCContainer.Unregister}.
   *
   * @example With declared dependencies
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Url = IoCToken<string>('Url');
   *
   * class Repo {
   *   constructor(public url: string) {}
   * }
   *
   * const ioc = new IoCContainer();
   *
   * ioc.RegisterValue($Url, 'kv://local');
   * ioc.RegisterClass(Repo, { Deps: [$Url] }); // checked against Repo's constructor
   * ```
   */
  public RegisterClass<
    C extends IoCServiceConstructor<unknown>,
    const TName extends string = '$default',
    TType extends symbol = never,
  >(
    clazz: C,
    options?: IoCRegisterClassOptions<C, TKeys, TName, TType>,
  ): IoCContainer<
    TKeys | ([TType] extends [never] ? IoCRegistered<C, TName> : IoCRegistered<TType, TName>)
  > {
    if (!isClassLike(clazz)) {
      throw new IoCRegistrationError(`RegisterClass expects a class.`);
    }

    const opts = { ...options };

    const type = (opts.Type as symbol | undefined) ??
      (clazz.name ? Symbol.for(clazz.name) : undefined);

    if (!type) throw new IoCRegistrationError(`The Type was missing for the registration.`);

    const deps = opts.Deps?.map(normalizeDependency);

    this.addRegistration({
      symbol: type,
      name: opts.Name || DEFAULT_NAME,
      lifetime: opts.Lifetime ?? 'singleton',
      kind: 'class',
      ctor: type === Symbol.for(clazz.name) ? clazz : undefined,
      factory: deps
        ? async (ioc) => new clazz(...await Promise.all(deps.map((d) => resolveDependency(ioc, d))))
        : () => new clazz(),
      lazy: this.lazyFor(opts.Lazy),
      deps,
      dispose: opts.Dispose as ((instance: unknown) => unknown) | undefined,
      default: opts.Default,
      replace: opts.Replace,
      scopeLevel: opts.ScopeLevel,
    });

    return this as unknown as IoCContainer<
      TKeys | ([TType] extends [never] ? IoCRegistered<C, TName> : IoCRegistered<TType, TName>)
    >;
  }

  /**
   * Registers a factory under a token, symbol or class key. The factory receives the container
   * (use it rather than a captured container so scopes and cycle detection work). Returns the
   * container, typed with the new key, so registrations chain.
   */
  public RegisterFactory<
    K extends IoCServiceKeyConstructor<unknown> | symbol,
    const TName extends string = '$default',
    const TDeps extends readonly IoCFactoryDependency<TKeys>[] = [],
  >(
    key: K,
    factory: (
      ioc: IoCContainer,
      ...deps: IoCDependencyValues<TDeps>
    ) => IoCServiceOf<K> | Promise<IoCServiceOf<K>>,
    options?: IoCRegisterOptions<TName, IoCServiceOf<K>> & {
      /**
       * Services to resolve and pass to the factory after the container, in order:
       * `RegisterFactory($Repo, (ioc, db, url) => …, { Deps: [$Db, $Url] })`. Each parameter
       * is typed from its key, and `Validate()` checks them like a class's `Deps`.
       */
      Deps?: TDeps;
    },
  ): IoCContainer<TKeys | IoCRegistered<K, TName>> {
    if (typeof factory !== 'function') {
      throw new IoCRegistrationError(`RegisterFactory expects a factory function.`);
    }

    const opts = { ...options };

    const symbol = keySymbol(key);

    const deps = opts.Deps?.map(normalizeDependency);

    const call = factory as (ioc: IoCContainer, ...deps: unknown[]) => unknown;

    this.addRegistration({
      symbol,
      name: opts.Name || DEFAULT_NAME,
      lifetime: opts.Lifetime ?? 'singleton',
      kind: 'factory',
      ctor: typeof key === 'function' ? key : undefined,
      factory: deps
        ? async (ioc) => call(ioc, ...await Promise.all(deps.map((d) => resolveDependency(ioc, d))))
        : call,
      lazy: this.lazyFor(opts.Lazy),
      deps,
      dispose: opts.Dispose as ((instance: unknown) => unknown) | undefined,
      default: opts.Default,
      replace: opts.Replace,
      scopeLevel: opts.ScopeLevel,
    });

    return this as unknown as IoCContainer<TKeys | IoCRegistered<K, TName>>;
  }

  /**
   * Registers an existing value (any value, including functions and thenables) as a singleton.
   * The container never invokes or disposes it. Returns the container, typed with the new key, so
   * registrations chain.
   */
  public RegisterValue<
    K extends IoCServiceKeyConstructor<unknown> | symbol,
    const TName extends string = '$default',
  >(
    key: K,
    value: IoCServiceOf<K>,
    options?: {
      Name?: TName;

      /** Hands the value to the container: it is cleaned up this way when the container is disposed. */
      Dispose?: (value: IoCServiceOf<K>) => unknown;

      /** A default value that yields to any other registration (see `IoCServiceOptions.Default`). */
      Default?: boolean;

      /** Replaces an existing registration on purpose (required in strict mode). */
      Replace?: boolean;
    },
  ): IoCContainer<TKeys | IoCRegistered<K, TName>> {
    // Values belong to whoever created them; no container disposes them unless asked to.
    if (!options?.Dispose && isDisposable(value) && !IOC_OWNERS.has(value)) {
      IOC_OWNERS.set(value, IOC_EXTERNAL);
    }

    this.addRegistration({
      symbol: keySymbol(key),
      name: options?.Name || DEFAULT_NAME,
      lifetime: 'singleton',
      kind: 'value',
      ctor: typeof key === 'function' ? key : undefined,
      factory: () => value,
      lazy: false,
      dispose: options?.Dispose as ((instance: unknown) => unknown) | undefined,
      default: options?.Default,
      replace: options?.Replace,
    });

    return this as unknown as IoCContainer<TKeys | IoCRegistered<K, TName>>;
  }

  /**
   * Wraps the current registration for a key with `decorator` (logging, caching, retries…). The
   * decorated service keeps the original's lifetime; decorators applied in order wrap each
   * other. In a scope, decorating a parent's registration only affects the scope. Returns a
   * function that restores the previous registration.
   *
   * @example Add caching around a service
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Prices = IoCToken<{ quote(symbol: string): number }>('Prices');
   *
   * const ioc = new IoCContainer();
   *
   * ioc.RegisterFactory($Prices, () => ({ quote: (symbol) => symbol.length }));
   * ioc.Decorate($Prices, (inner) => {
   *   const cache = new Map<string, number>();
   *   return { quote: (s) => cache.get(s) ?? cache.set(s, inner.quote(s)).get(s)! };
   * });
   * ```
   */
  public Decorate<T>(
    key: IoCServiceKey<T> | symbol,
    decorator: (inner: T, ioc: IoCContainer) => T | Promise<T>,
    options?: { Name?: string },
  ): () => void {
    const self = this.self();

    const name = options?.Name || DEFAULT_NAME;

    const symbol = keySymbol(key);

    const ownBank = self.services.get(symbol);

    const previousOwn = ownBank?.has(name) ? { entry: ownBank.get(name) } : undefined;

    const original = self.lookup(key, name, undefined);

    const originalReg = registrationOf(original);

    const lifetime: IoCLifetime = originalReg?.lifetime ??
      (typeof original === 'function' && !original.name ? 'transient' : 'singleton');

    const decorate = (inner: unknown) => (ioc: IoCContainer) => {
      const value = ioc.realize(inner, ioc.frame());

      return value instanceof Promise
        ? value.then((v) => decorator(v as T, ioc))
        : decorator(value as T, ioc);
    };

    const remove = self.addRegistration({
      symbol,
      name,
      lifetime,
      kind: 'factory',
      ctor: typeof key === 'function' ? key : originalReg?.ctor,
      factory: decorate(original),
      // An isolated decorator wraps an isolated copy of what it decorates.
      fork: (owner) => decorate(registrationOf(original)?.fork?.(owner) ?? original),
      lazy: true,
      deps: originalReg?.deps,
      replace: true,
    });

    return () => {
      const bank = self.services.get(symbol);

      const current = bank?.get(name);

      remove();

      // Put back what this container had before, unless something else replaced the decorator.
      if (previousOwn && bank && !bank.has(name) && current !== undefined) {
        self.RegisterDirect(symbol, name, previousOwn.entry as IoCServiceConstructed);
      }
    };
  }

  /**
   * Removes a registration from this container (not from parents). Returns whether one existed.
   */
  public Unregister(key: IoCServiceKey<unknown> | symbol, name?: string): boolean {
    const self = this.self();

    const symbol = keySymbol(key);

    const n = name ?? DEFAULT_NAME;

    const bank = self.services.get(symbol);

    if (typeof key === 'symbol') {
      // By symbol: remove the registration and every class registered under the symbol + name.
      let removed = !!bank?.delete(n);

      for (const [ctor, entries] of [...self.byCtor]) {
        const entry = entries.get(n);

        if (entry !== undefined && registrationOf(entry)?.symbol === symbol) {
          self.untrackCtor(ctor, n, entry);
          removed = true;
        }
      }

      return removed;
    }

    const found = self.findOwn(key, n);

    if (!found) return false;

    const reg = registrationOf(found.entry);

    if (reg?.ctor) self.untrackCtor(reg.ctor, n, found.entry);

    // Only drop the name bank entry when it is the one being unregistered; a same-named class
    // that currently owns the name keeps its registration.
    if (bank && bank.get(n) === found.entry) bank.delete(n);

    return true;
  }

  /**
   * Stores a raw entry. Plain values are returned as-is by `Resolve`; anonymous functions are
   * treated as thunks and invoked (legacy behavior used by older containers' `CopyTo`).
   */
  public RegisterDirect(
    symbol: symbol,
    name: string,
    instance: IoCServiceConstructed,
  ): void | (() => void) {
    const self = this.self();

    const reg = registrationOf(instance);

    // An incoming default (for example from a plugin container's CopyTo) never replaces a
    // registration that isn't a default.
    if (reg?.default) {
      const existing = self.services.get(symbol)?.get(name);

      if (existing !== undefined && existing !== instance && !registrationOf(existing)?.default) {
        return;
      }
    }

    self.bank(symbol).set(name, instance);

    // Record which module (if any) made the registration now in place.
    if (self.applying !== undefined) {
      let names = self.origins.get(symbol);

      if (!names) self.origins.set(symbol, names = new Map());

      names.set(name, self.applying);
    } else {
      self.origins.get(symbol)?.delete(name);
    }

    if (reg?.ctor && reg.symbol === symbol && reg.name === name) {
      self.trackCtor(reg.ctor, name, instance);
    }
  }

  /** Returns `Symbol.for(id)`, registering it with this container. */
  public Symbol(id: string): symbol {
    const self = this.self();

    if (!self.symbols.has(id)) {
      self.symbols.set(id, Symbol.for(id));
    }

    const symbol = self.symbols.get(id)!;

    self.bank(symbol);

    return symbol;
  }

  //#endregion

  //#region Scopes, copying and disposal

  /**
   * Creates a child scope. The scope resolves everything its parent can; `scoped` registrations
   * get one instance per scope, singletons stay shared with the parent, and registrations made
   * on the scope override the parent's for this scope only (handy for per-request services and
   * for test overrides). Dispose the scope when done — `await using scope = ioc.CreateScope()`
   * — to dispose the instances it created.
   *
   * Give a scope a `Level` (`'tenant'`, `'request'`, …) to host `scoped` registrations made with
   * a matching `ScopeLevel`: they live in the nearest scope of that level, so scopes nested
   * inside it share its instance.
   *
   * @example One scope per request
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Request = IoCToken<Request>('Request');
   *
   * const ioc = new IoCContainer();
   *
   * async function handle(req: Request): Promise<Response> {
   *   await using scope = ioc.CreateScope();
   *
   *   scope.RegisterValue($Request, req);
   *
   *   return new Response(new URL((await scope.Resolve($Request)).url).pathname);
   * }
   *
   * await handle(new Request('http://localhost/notes'));
   * ```
   */
  public CreateScope(options?: { Level?: string }): IoCContainer<TKeys> {
    const self = this.self();

    self.assertNotDisposed();

    const scope = new IoCContainer<TKeys>(self.options);

    scope.parent = self;

    scope.level = options?.Level;

    return scope;
  }

  /**
   * Gives this scope its own instances of services registered in a parent: each key (or
   * `[key, name]`) is registered again here with the parent's recipe (same factory, lifetime,
   * dependencies and `Dispose` option), so this scope builds, caches and disposes a fresh one
   * while everything else stays shared. Use it for sub-units that must not share state with
   * their siblings, such as one agent's memory or one CLI command group's settings. Its
   * dependencies are resolved from this scope, so isolate those too when they must be separate.
   *
   * @example
   * ```ts
   * import { IoCContainer } from '@fathym/ioc';
   *
   * class Memory {
   *   public notes: string[] = [];
   * }
   *
   * const ioc = new IoCContainer().RegisterClass(Memory, { Lazy: true });
   *
   * await using agent = ioc.CreateScope({ Level: 'agent' }).Isolate(Memory);
   *
   * (await agent.Resolve(Memory)).notes.push('only mine');
   *
   * console.log((await ioc.Resolve(Memory)).notes.length); // 0
   * ```
   */
  public Isolate(
    ...keys:
      (IoCServiceKey<unknown> | symbol | readonly [IoCServiceKey<unknown> | symbol, string])[]
  ): this {
    const self = this.self();

    self.assertNotDisposed();

    const parent = self.parent;

    if (!parent) {
      throw new IoCRegistrationError(
        'Isolate() works on scopes; call it on a container created with CreateScope().',
      );
    }

    for (const item of keys) {
      const [key, name] = Array.isArray(item)
        ? item as readonly [IoCServiceKey<unknown> | symbol, string]
        : [item as IoCServiceKey<unknown> | symbol, DEFAULT_NAME];

      const symbol = keySymbol(key);

      const entry = parent.lookup(key, name, undefined);

      const reg = registrationOf(entry);

      const label = labelFor(symbol, name);

      if (!reg?.fork) {
        throw new IoCNotIsolatableError(
          label,
          'it was registered by a version of @fathym/ioc without Isolate() support',
        );
      }

      if (reg.kind === 'value') {
        throw new IoCNotIsolatableError(label, 'it is a value, which every scope shares as is');
      }

      self.RegisterDirect(symbol, name, reg.fork(self) as IoCServiceConstructed);
    }

    return this;
  }

  /**
   * Replaces a registration with a value until the returned function is called, which puts back
   * exactly what was there before (or removes the override when nothing was). Meant for tests:
   * it never throws in strict mode and reports no diagnostic. Instances already built from the
   * old registration keep what they were given, so override before resolving the services that
   * use it, or override in a scope (`ioc.CreateScope()`) and resolve from there.
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Now = IoCToken<() => number, 'Now'>('Now');
   *
   * const ioc = IoCContainer.Create().RegisterValue($Now, () => Date.now());
   *
   * const restore = ioc.Override($Now, () => 0);
   *
   * console.log((await ioc.Resolve($Now))()); // 0
   *
   * restore();
   * ```
   */
  public Override<K extends IoCServiceKeyConstructor<unknown> | symbol>(
    key: K,
    value: IoCServiceOf<K>,
    options?: { Name?: string },
  ): () => void {
    const self = this.self();

    const symbol = keySymbol(key);

    const name = options?.Name || DEFAULT_NAME;

    const bank = self.services.get(symbol);

    const previous = bank?.has(name) ? { entry: bank.get(name) } : undefined;

    self.RegisterValue(key as symbol, value as never, { Name: name, Replace: true });

    const override = self.services.get(symbol)?.get(name);

    return () => {
      const current = self.services.get(symbol);

      // Something replaced the override since; leave it alone.
      if (!current || current.get(name) !== override) return;

      if (previous) {
        self.RegisterDirect(symbol, name, previous.entry as IoCServiceConstructed);
      } else {
        self.Unregister(key as symbol, name);
      }
    };
  }

  /**
   * Describes everything visible from this container as plain data: each registration's key,
   * name, kind, lifetime, level, module, declared and observed dependencies, whether it is
   * shadowed by a nearer scope, and whether it is built; plus the modules and their state.
   * Builds nothing. Use it for debugging, diagrams, health pages and tooling.
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Url = IoCToken<string, 'DescribeUrl'>('DescribeUrl');
   *
   * class Repo {
   *   constructor(public url: string) {}
   * }
   *
   * const ioc = new IoCContainer()
   *   .RegisterValue($Url, 'kv://local')
   *   .RegisterClass(Repo, { Deps: [$Url], Lazy: true });
   *
   * for (const s of ioc.Describe().Services) {
   *   console.log(`${s.Label} (${s.Kind}, ${s.Lifetime}) -> ${s.Deps.join(', ') || 'nothing'}`);
   * }
   * ```
   */
  public Describe(): IoCDescription {
    const self = this.self();

    const services: IoCServiceDescription[] = [];

    const visible = new Set<string>();

    let depth = 0;

    for (const container of self.chain()) {
      for (const [symbol, bank] of container.services) {
        for (const [name, entry] of bank) {
          const reg = registrationOf(entry);

          const label = reg?.label ?? labelFor(symbol, name);

          const id = `${symbol.toString()}\u0000${name}`;

          const holder = reg?.lifetime === 'scoped' && container !== self
            ? self.scopedHolders.get(reg)
            : reg?.holder;

          services.push({
            Key: symbol.description ?? '',
            Name: name,
            Label: label,
            Kind: reg?.kind ?? 'external',
            Lifetime: reg?.lifetime,
            ScopeLevel: reg?.scopeLevel,
            Default: !!reg?.default,
            Module: container.origins.get(symbol)?.get(name),
            Depth: depth,
            Shadowed: visible.has(id),
            Deps: (reg?.deps ?? []).map((d) =>
              `${d.mode ? `${d.mode}:` : ''}${labelFor(keySymbol(d.key), d.name)}`
            ),
            Observed: [...(reg?.observed?.keys() ?? [])],
            State: reg && reg.lifetime !== 'transient' ? holder?.state ?? 'empty' : undefined,
          });

          visible.add(id);
        }
      }

      depth++;
    }

    const modules: IoCDescription['Modules'] = [];

    depth = 0;

    for (const container of self.chain()) {
      for (const module of container.modules) {
        modules.push({
          Name: module.Name,
          Requires: (module.Requires ?? []).map((m) => m.Name),
          Started: container.started.includes(module),
          Depth: depth,
        });
      }

      depth++;
    }

    return { Level: self.level, Scope: !!self.parent, Services: services, Modules: modules };
  }

  /**
   * Copies every registration into `ioc` (for a scope: its own and its parents', nearest
   * winning), replacing registrations it already has with the same symbol and name. Singletons
   * are shared (both containers resolve the same instance) and transient factories receive the
   * container they are resolved from.
   */
  public CopyTo(ioc: IoCContainer): void {
    const target = ioc as Indexable;

    const protocolAware = (target?.[IOC_PROTOCOL] ?? 0) >= 1;

    const chain = [...this.chain()].reverse();

    for (const container of chain) {
      for (const [symbol, bank] of container.services) {
        for (const [name, entry] of bank) {
          if (protocolAware) {
            target.RegisterDirect(symbol, name, entry);
          } else {
            // Older containers only know symbols from their own `Symbol(id)` registry.
            if (symbol.description === undefined) continue;

            const reg = registrationOf(entry);

            target.RegisterDirect(
              target.Symbol(symbol.description),
              name,
              reg ? createLegacyThunk(reg, target) : entry,
            );
          }
        }
      }

      // RegisterDirect already tracked the classes that own their name bank entries; this
      // carries over same-named classes whose entries were shadowed by a later registration.
      if (protocolAware && typeof target.trackCtor === 'function') {
        for (const [ctor, entries] of container.byCtor) {
          for (const [name, entry] of entries) {
            target.trackCtor(ctor, name, entry);
          }
        }
      }
    }
  }

  /**
   * Disposes, in reverse creation order, the instances this container (or scope) created that
   * implement `Symbol.asyncDispose` or `Symbol.dispose`, then clears its registrations. Values
   * registered with `RegisterValue` and transient instances are never disposed. Errors are
   * collected into an `AggregateError`. Disposing a container does not dispose its scopes.
   */
  public async Dispose(): Promise<void> {
    const self = this.self();

    if (self.disposed) return;

    // A second call waits for the first to finish; the first caller gets any errors.
    if (self.disposing) return await self.disposing.catch(noop);

    await (self.disposing = self.disposeNow());
  }

  /** Same as {@link IoCContainer.Dispose}; enables `await using`. */
  public async [Symbol.asyncDispose](): Promise<void> {
    await this.Dispose();
  }

  //#endregion

  //#region Modules and lifecycle

  /**
   * Adds modules: each module's `Requires` are added first (depth-first), then its `Register`
   * runs against this container. A module already added here or in a parent is skipped, so
   * shared requirements are registered once. Registrations a module makes are recorded as its
   * own (see `Describe()`). Modules must be added before {@link IoCContainer.Start}.
   *
   * @example
   * ```ts
   * import { IoCContainer, type IoCModule, IoCToken } from '@fathym/ioc';
   *
   * const $Url = IoCToken<string, 'Url'>('Url');
   * const $Client = IoCToken<{ url: string }, 'Client'>('Client');
   *
   * const Config: IoCModule = {
   *   Name: 'Config',
   *   Register: (ioc) => ioc.RegisterValue($Url, 'kv://local', { Default: true }),
   * };
   *
   * const Client: IoCModule = {
   *   Name: 'Client',
   *   Requires: [Config],
   *   Register: (ioc) => ioc.RegisterFactory($Client, async (c) => ({ url: await c.Resolve($Url) })),
   * };
   *
   * const ioc = new IoCContainer().Use(Client); // registers Config, then Client
   *
   * console.log((await ioc.Resolve($Client)).url); // kv://local
   * ```
   */
  public Use(...modules: IoCModule[]): this {
    const self = this.self();

    self.assertNotDisposed();

    const visit = (module: IoCModule, path: IoCModule[]) => {
      if (
        !module || typeof module.Name !== 'string' || typeof module.Register !== 'function'
      ) {
        throw new IoCRegistrationError('A module needs a Name and a Register(ioc) function.');
      }

      if (self.hasModule(module)) return;

      if (path.includes(module)) {
        throw new IoCModuleCycleError(
          [...path.slice(path.indexOf(module)), module].map((m) => m.Name),
        );
      }

      for (const required of module.Requires ?? []) visit(required, [...path, module]);

      if (self.starting) {
        throw new IoCRegistrationError(
          `Module '${module.Name}' was added after Start(); add modules before starting the ` +
            `container.`,
        );
      }

      if (self.modules.some((m) => m.Name === module.Name)) {
        self.diagnose(
          'IOC_MODULE_DUPLICATE',
          `Two different modules are named '${module.Name}'; both were added.`,
          module.Name,
        );
      }

      const previous = self.applying;

      self.applying = module.Name;

      try {
        module.Register(self);
      } finally {
        self.applying = previous;
      }

      self.modules.push(module);
    };

    for (const module of modules) visit(module, []);

    return this;
  }

  /**
   * Starts the container: checks the wiring with `Validate()` (skip it with
   * `{ Validate: false }`), builds every singleton with `Activate()`, then runs each module's
   * `OnStart` in the order the modules were added. If an `OnStart` fails, the modules already
   * started are stopped (their `OnStop`, in reverse) and an {@link IoCStartError} is thrown;
   * `Start()` can then be called again. Calling it again after it succeeded does nothing.
   * `Dispose()` (or `await using`) runs the started modules' `OnStop` before disposing anything.
   *
   * @example
   * ```ts
   * import { IoCContainer, type IoCModule } from '@fathym/ioc';
   *
   * const events: string[] = [];
   *
   * const Server: IoCModule = {
   *   Name: 'Server',
   *   Register: () => {},
   *   OnStart: () => events.push('listening'),
   *   OnStop: () => events.push('closed'),
   * };
   *
   * {
   *   await using ioc = new IoCContainer().Use(Server);
   *
   *   await ioc.Start();
   * }
   *
   * console.log(events); // ['listening', 'closed']
   * ```
   */
  public Start(options?: { Validate?: boolean }): Promise<void> {
    const self = this.self();

    self.assertNotDisposed();

    return self.starting ??= self.startNow(options);
  }

  //#endregion

  //#region Internals

  /**
   * Applies `PendingTimeoutMs` to a pending resolution.
   *
   * @ignore
   */
  protected limit(
    value: unknown,
    entry: unknown,
    key: AnyFunction | symbol,
    name: string | undefined,
  ): unknown {
    const ms = this.self().options?.PendingTimeoutMs;

    if (!ms || !(value instanceof Promise)) return value;

    const reg = registrationOf(entry);

    const label = reg?.label ?? labelFor(keySymbol(key), name ?? DEFAULT_NAME);

    let timer: unknown;

    const timeout = new Promise<never>((_, reject) => {
      timer = timers.setTimeout(() => {
        reject(new IoCResolveTimeoutError(label, ms, pendingLabels(reg?.holder)));
      }, ms);
    });

    return Promise.race([value, timeout]).finally(() => timers.clearTimeout(timer));
  }

  /**
   * Runs `Start()` once.
   *
   * @ignore
   */
  protected async startNow(options?: { Validate?: boolean }): Promise<void> {
    try {
      if (options?.Validate !== false) this.Validate();

      await this.Activate();

      for (const module of this.modules) {
        if (this.disposed || this.disposing) return;

        try {
          await module.OnStart?.(this);
        } catch (err) {
          throw new IoCStartError(module.Name, err, await this.stopModules());
        }

        this.started.push(module);
      }
    } catch (err) {
      this.starting = undefined;
      throw err;
    }
  }

  /**
   * Runs `OnStop` for the started modules, in reverse, collecting errors.
   *
   * @ignore
   */
  protected async stopModules(): Promise<unknown[]> {
    const errors: unknown[] = [];

    for (const module of this.started.splice(0).reverse()) {
      try {
        await module.OnStop?.(this);
      } catch (err) {
        errors.push(err);
      }
    }

    return errors;
  }

  /**
   * True when `module` was added to this container or a parent.
   *
   * @ignore
   */
  protected hasModule(module: IoCModule): boolean {
    for (const c of this.chain()) {
      if (c.modules?.includes(module)) return true;
    }

    return false;
  }

  /**
   * Stops the modules, then disposes the owned instances.
   *
   * @ignore
   */
  protected async disposeNow(): Promise<void> {
    const self = this.self();

    // Modules stop while their services are still alive.
    const errors: unknown[] = await self.stopModules();

    self.disposed = true;

    const owned = self.owned.splice(0).reverse();

    for (const value of owned) {
      try {
        await disposeOne(value);
      } catch (err) {
        errors.push(err);
      }
    }

    self.scopedHolders.clear();
    self.services.clear();
    self.byCtor.clear();
    self.origins.clear();

    if (errors.length) {
      throw new IoCDisposeError(errors);
    }
  }

  /**
   * The resolution frame a call continues: the view's frame, else the running factory's.
   *
   * @ignore
   */
  protected frame(): IoCResolveFrame | undefined {
    const frame = (this as Indexable)[IOC_CONTEXT] ?? currentFrame();

    if (frame) return frame;

    // A captured container used after an `await`: the async context still knows the chain.
    const stored = this.self().options?.AsyncContext?.getStore() as IoCResolveFrame | undefined;

    return stored && !stored.settled && typeof stored.label === 'string' ? stored : undefined;
  }

  /**
   * The real container behind a context view (or this container).
   *
   * @ignore
   */
  protected self(): IoCContainer {
    return (this as Indexable)[IOC_SELF] ?? this;
  }

  /**
   * This container followed by its ancestors.
   *
   * @ignore
   */
  protected *chain(): Generator<IoCContainer> {
    for (let c: IoCContainer | undefined = this.self(); c; c = c.parent) {
      yield c;
    }
  }

  /**
   * Whether a registration is lazy: its own `Lazy` option, else the container's `LazyByDefault`.
   *
   * @ignore
   */
  protected lazyFor(lazy: boolean | undefined): boolean {
    return lazy ?? !!this.self().options?.LazyByDefault;
  }

  /**
   * Reports a diagnostic to the `Diagnostics` option, if one was given.
   *
   * @ignore
   */
  protected diagnose(code: IoCDiagnosticCode, message: string, service?: string): void {
    this.self().options?.Diagnostics?.({ Code: code, Message: message, Service: service });
  }

  /**
   * Throws when this container, or any container it was scoped from, has been disposed.
   *
   * @ignore
   */
  protected assertNotDisposed(): void {
    for (const c of this.chain()) {
      if (c.disposed) throw new IoCContainerDisposedError();
    }
  }

  /**
   * True when `symbol` + `name` was declared with `Expect()` here or in a parent.
   *
   * @ignore
   */
  protected isExpected(symbol: symbol, name: string): boolean {
    for (const c of this.chain()) {
      if (c.expected?.get(symbol)?.has(name)) return true;
    }

    return false;
  }

  /**
   * The name bank for `symbol`, created on demand for any symbol.
   *
   * @ignore
   */
  protected bank(symbol: symbol): Map<string, IoCServiceResolutions> {
    let bank = this.services.get(symbol);

    if (!bank) {
      bank = new Map();
      this.services.set(symbol, bank);
    }

    return bank;
  }

  /** @ignore */
  protected trackCtor(ctor: AnyFunction, name: string, entry: unknown): void {
    let entries = this.byCtor.get(ctor);

    if (!entries) {
      entries = new Map();
      this.byCtor.set(ctor, entries);
    }

    entries.set(name, entry);
  }

  /** @ignore */
  protected untrackCtor(ctor: AnyFunction, name: string, entry: unknown): void {
    const entries = this.byCtor.get(ctor);

    if (entries && entries.get(name) === entry) {
      entries.delete(name);

      if (!entries.size) this.byCtor.delete(ctor);
    }
  }

  /**
   * Records an instance this container created, for disposal. The first container to create an
   * instance owns it: an instance that already has an owner (returned again by a decorator or an
   * alias factory, or a value given to `RegisterValue`) is never owned twice. An instance that
   * arrives after this container was disposed (its build was still in flight) is disposed now.
   *
   * @ignore
   */
  protected trackOwned(value: unknown): void {
    if (!isDisposable(value) || IOC_OWNERS.has(value)) return;

    const self = this.self();

    IOC_OWNERS.set(value, self);

    if (!self.disposed) {
      self.owned.push(value);
      return;
    }

    disposeOne(value).catch((err) =>
      self.diagnose(
        'IOC_LATE_DISPOSE_FAILED',
        `An instance that finished building after Dispose() failed to dispose: ${err}`,
      )
    );
  }

  /**
   * The container a level-bound `scoped` registration (`ScopeLevel`) lives in: the nearest scope,
   * from this one up, created with that level.
   *
   * @ignore
   */
  protected scopedSiteFor(reg: IoCRegistration): IoCContainer | undefined {
    for (const c of this.chain()) {
      if (c.level !== undefined && c.level === reg.scopeLevel) return c;
    }

    return undefined;
  }

  /**
   * This scope's holder for a `scoped` registration owned by an ancestor (created on demand), or
   * undefined when this container is not a child scope of the owner.
   *
   * @ignore
   */
  protected scopedHolderFor(reg: IoCRegistration): IoCHolder | undefined {
    if (!this.parent || reg.owner === this) return undefined;

    let holder = this.scopedHolders.get(reg);

    if (!holder) {
      holder = { state: 'empty' };
      this.scopedHolders.set(reg, holder);
    }

    return holder;
  }

  /**
   * The entry registered for exactly this key in this container: for a class, its own
   * registration (or a symbol registration of its name); never a different same-named class.
   *
   * @ignore
   */
  protected findExactOwn(key: AnyFunction | symbol, name: string): unknown {
    const bank = this.services.get(keySymbol(key));

    if (typeof key !== 'function') return bank?.get(name);

    const own = this.byCtor.get(key)?.get(name);

    if (own !== undefined) return own;

    const entry = bank?.get(name);

    if (entry === undefined) return undefined;

    const reg = registrationOf(entry);

    return !reg?.ctor || reg.ctor === key ? entry : undefined;
  }

  /**
   * Finds the stored entry for a key in this container only.
   *
   * @ignore
   */
  protected findOwn(key: AnyFunction | symbol, name: string): FoundEntry | undefined {
    const bank = this.services.get(keySymbol(key));

    if (!bank?.has(name)) {
      // The name owner was removed; a same-named class may still have its own registration.
      if (typeof key === 'function') {
        const own = this.byCtor.get(key);

        if (own?.has(name)) return { entry: own.get(name) };
      }

      return undefined;
    }

    const entry = bank.get(name);

    if (typeof key === 'function') {
      const reg = registrationOf(entry);

      // A different class with the same name owns the name bank entry; prefer this class's
      // own registration when there is one.
      if (reg?.ctor && reg.ctor !== key) {
        const own = this.byCtor.get(key);

        if (own?.has(name)) return { entry: own.get(name) };

        // Otherwise it would resolve the other class's instance. Strict mode allows that only
        // for two copies of the same class (identical source, as with duplicated packages).
        if (this.self().options?.Strict && !sameSource(reg.ctor, key)) return undefined;
      }
    }

    return { entry };
  }

  /**
   * Finds the stored entry for a key, nearest scope first. Never mutates.
   *
   * @ignore
   */
  protected find(key: AnyFunction | symbol, name: string): FoundEntry | undefined {
    for (let c: IoCContainer | undefined = this.self(); c; c = c.parent) {
      const found = c.findOwn(key, name);

      if (found) return found;
    }

    return undefined;
  }

  /**
   * Like `find`, but throws {@link IoCServiceNotFoundError} when nothing is registered.
   *
   * @ignore
   */
  protected lookup(
    key: AnyFunction | symbol,
    name: string,
    frame: IoCResolveFrame | undefined,
  ): unknown {
    const found = this.find(key, name);

    if (found) {
      if (typeof key === 'function') {
        const reg = registrationOf(found.entry);

        if (reg?.ctor && reg.ctor !== key && !sameSource(reg.ctor, key)) {
          this.diagnose(
            'IOC_CLASS_NAME_FALLBACK',
            `${reg.label} resolved a different class that shares the name '${key.name}'; ` +
              `register the class itself, or enable Strict to make this an error.`,
            reg.label,
          );
        }
      }

      return found.entry;
    }

    const symbol = keySymbol(key);

    const names = new Set<string>();

    for (const container of this.chain()) {
      for (const n of container.services.get(symbol)?.keys() ?? []) names.add(n);
    }

    throw new IoCServiceNotFoundError(
      symbol,
      name,
      [...names],
      framePath(frame),
      this.isExpected(symbol, name)
        ? 'It is declared with Expect(); register it on the container or scope that provides it.'
        : undefined,
    );
  }

  /**
   * Turns a stored entry into the service value (or a promise of it).
   *
   * @ignore
   */
  protected realize(entry: unknown, frame: IoCResolveFrame | undefined): unknown {
    const reg = registrationOf(entry);

    if (reg) return reg.resolveIn(this.self(), frame);

    // Legacy thunks stored through RegisterDirect (for example by an older container's CopyTo).
    if (typeof entry === 'function' && !entry.name) {
      return (entry as (ioc: IoCContainer) => unknown)(this.self());
    }

    return entry;
  }

  /**
   * Creates and stores a registration, building it now unless it is lazy or transient. Returns
   * a function that removes exactly this registration.
   *
   * @ignore
   */
  protected addRegistration(spec: {
    symbol: symbol;
    name: string;
    lifetime: IoCLifetime;
    kind: IoCRegistration['kind'];
    ctor?: AnyFunction;
    factory: (ioc: IoCContainer) => unknown;
    lazy: boolean;
    deps?: readonly IoCDependencyRecord[];
    dispose?: (instance: unknown) => unknown;
    default?: boolean;
    replace?: boolean;
    scopeLevel?: string;
    /** Makes the factory for an isolated copy owned by `owner` (default: the same factory). */
    fork?: (owner: IoCContainer) => (ioc: IoCContainer) => unknown;
    /** Create the registration without checks or storing it, and return its thunk. */
    detached?: boolean;
  }): () => void {
    const self = this.self();

    self.assertNotDisposed();

    const { symbol, name, lifetime, factory } = spec;

    const strict = !!self.options?.Strict;

    const exactKey = spec.ctor ?? symbol;

    // A default yields to any registration of the same key and name, here or in a parent.
    if (spec.default && !spec.detached) {
      for (const c of self.chain()) {
        const existing = c.findExactOwn(exactKey, name);

        if (existing !== undefined && registrationOf(existing)?.default !== true) return noop;
      }
    }

    if (!spec.default && !spec.replace) {
      const existing = self.findExactOwn(exactKey, name);

      if (existing !== undefined && registrationOf(existing)?.default !== true) {
        const label = labelFor(symbol, name);

        if (strict) throw new IoCDuplicateRegistrationError(label);

        self.diagnose(
          'IOC_REGISTRATION_REPLACED',
          `${label} was registered again; the new registration replaces the earlier one.`,
          label,
        );
      }
    }

    // A class and a token on one key would resolve as each other.
    if (!spec.replace) {
      const isClassKey = !!spec.ctor;

      for (const c of self.chain()) {
        for (const entry of c.services.get(symbol)?.values() ?? []) {
          const reg = registrationOf(entry);

          if (!reg || reg.default || !!reg.ctor === isClassKey) continue;

          const key = `${symbol.description}`;

          if (strict) throw new IoCKeyCollisionError(key);

          self.diagnose(
            'IOC_KEY_COLLISION',
            `The key '${key}' is used by both a class and a token.`,
            key,
          );

          break;
        }
      }
    }

    const holder: IoCHolder | undefined = lifetime === 'transient' ? undefined : { state: 'empty' };

    const label = labelFor(symbol, name);

    const owns = spec.kind !== 'value' || !!spec.dispose;

    const { dispose } = spec;

    /** Hands an instance to its owner: the `Dispose` option's cleanup, else the instance itself. */
    const own = (tracker: IoCContainer, value: unknown) => {
      if (!dispose) return tracker.trackOwned(value);

      const isObject = (typeof value === 'object' || typeof value === 'function') && value !== null;

      // An instance someone else already owns is theirs to clean up.
      if (isObject && IOC_OWNERS.has(value)) return;

      if (isObject) IOC_OWNERS.set(value, tracker.self());

      tracker.trackOwned({ [Symbol.asyncDispose]: async () => await dispose(value) });
    };

    /**
     * Invokes the factory as one frame of a resolution chain. Factories receive a view of
     * `container` that carries the chain, so resolves made through the parameter (even after an
     * `await`) take part in cycle detection.
     */
    const run = (container: object, parent: IoCResolveFrame | undefined, key: object) => {
      const frame: IoCResolveFrame = { key, label, parent, settled: false, reg };

      if (isHolder(key)) key.building = frame;

      let result: unknown;

      try {
        const arg = createView(container, frame) as IoCContainer;

        const context = self.options?.AsyncContext;

        result = context
          ? context.run(frame, () => withFrame(frame, () => factory(arg)))
          : withFrame(frame, () => factory(arg));
      } catch (err) {
        frame.settled = true;
        frame.failed = { error: err };
        throw err;
      }

      if (result instanceof Promise) {
        return result.then(
          (value) => {
            frame.settled = true;
            return value;
          },
          (err) => {
            frame.settled = true;
            frame.failed = { error: err };
            throw err;
          },
        );
      }

      frame.settled = true;

      return result;
    };

    /** Builds into `h` (if empty) against `buildOn`, recording the instance on `tracker`. */
    const fromHolder = (
      h: IoCHolder,
      buildOn: IoCContainer,
      tracker: IoCContainer,
      frame: IoCResolveFrame | undefined,
    ): unknown => {
      if (h.state === 'ready') return h.value;

      if (h.state === 'pending') {
        // A synchronous factory re-entering itself, or a chain waiting on its own result.
        if (!h.promise || isOnActivePath(frame, h)) {
          throw new IoCCircularDependencyError([...framePath(frame), label]);
        }

        // Another resolution is building it. If that build is (transitively) waiting on a build
        // in this chain, waiting here would deadlock both: report the cycle instead.
        const mine = activeHolders(frame);

        if (mine.length) {
          // A cycle has to enter this chain through a wait on one of its holders; when nothing
          // waits on any of them, there is nothing to search.
          if (mine.some((p) => p.waitedBy)) {
            const via = waitPath(h, new Set(mine));

            if (via) throw new IoCCircularDependencyError([...framePath(frame), ...via]);
          }

          // Only the innermost build records the wait; `children` links it to the builds above.
          const waiter = mine[0];

          (waiter.waits ??= new Set()).add(h);

          h.waitedBy = (h.waitedBy ?? 0) + 1;

          h.promise.finally(() => {
            waiter.waits?.delete(h);
            h.waitedBy!--;
          }).catch(noop);
        }

        return h.promise;
      }

      // A resolve left running inside a build that already failed starts nothing new.
      const abandoned = abandonedBy(frame);

      if (abandoned) throw abandoned.error;

      h.state = 'pending';

      attachBuild(h, nearestHolder(frame));

      let result: unknown;

      try {
        result = run(buildOn, frame, h);
      } catch (err) {
        h.state = 'empty';
        releaseBuild(h);
        throw err;
      }

      return track(h, settleInto(h, result), tracker);
    };

    const track = (h: IoCHolder, result: unknown, tracker: IoCContainer): unknown => {
      if (!owns) return result;

      if (h.state === 'ready') {
        own(tracker, result);
      } else if (result instanceof Promise) {
        result.then((value) => own(tracker, value), noop);
      }

      return result;
    };

    const reg: IoCRegistration = {
      v: 1,
      symbol,
      name,
      lifetime,
      kind: spec.kind,
      ctor: spec.ctor,
      owner: self,
      holder,
      label,
      deps: spec.deps,
      default: spec.default || undefined,
      scopeLevel: spec.scopeLevel,
      observed: new Map(),
      fork(owner: object): unknown {
        const target = owner as IoCContainer;

        return target.addRegistration({
          ...spec,
          factory: spec.fork ? spec.fork(target) : factory,
          lazy: true,
          default: undefined,
          replace: true,
          detached: true,
        });
      },
      resolveIn(container: object, frame?: IoCResolveFrame): unknown {
        if (!holder) {
          if (isOnActivePath(frame, reg)) {
            throw new IoCCircularDependencyError([...framePath(frame), label]);
          }

          const abandoned = abandonedBy(frame);

          if (abandoned) throw abandoned.error;

          return run(container, frame, reg);
        }

        if (lifetime === 'scoped' && reg.scopeLevel !== undefined) {
          const c = container as Indexable;

          // The nearest scope of the required level owns the instance.
          const site: Indexable = typeof c.scopedSiteFor === 'function'
            ? c.scopedSiteFor(reg)
            : undefined;

          if (!site) throw new IoCScopeRequiredError(label, reg.scopeLevel);

          const scoped: IoCHolder | undefined = site.scopedHolderFor(reg);

          return scoped
            ? fromHolder(scoped, site, site, frame)
            : fromHolder(holder!, self, self, frame);
        }

        if (lifetime === 'scoped') {
          const c = container as Indexable;

          const scoped: IoCHolder | undefined = typeof c.scopedHolderFor === 'function'
            ? c.scopedHolderFor(reg)
            : undefined;

          // One instance per child scope, built against (and disposed by) that scope.
          if (scoped) return fromHolder(scoped, c, c, frame);

          // Resolving from the root, where it would silently act as one shared instance.
          if (c.options?.Strict && !c.parent) throw new IoCScopeRequiredError(label);
        }

        // Singletons always build against their owner, never against whoever resolved them.
        return fromHolder(holder, self, self, frame);
      },
    };

    const thunk = createThunk(reg);

    // Defaults are always lazy (an overridden default is never built), and in strict mode a root
    // `scoped` registration is never built at the root.
    const lazy = spec.lazy || !!spec.default || spec.scopeLevel !== undefined ||
      (lifetime === 'scoped' && strict && !self.parent);

    // An isolated copy (see Isolate) is returned to the caller to store.
    if (spec.detached) return thunk as unknown as () => void;

    if (holder && !lazy) {
      // Eager: build now. A synchronous throw propagates and leaves any previous registration in
      // place. An async rejection never becomes an unhandled rejection; it resets the holder so a
      // Resolve made after it settled retries (for example once a missing dependency has been
      // registered).
      holder.state = 'pending';

      let result: unknown;

      try {
        result = run(self, undefined, holder);
      } catch (err) {
        holder.state = 'empty';
        releaseBuild(holder);
        throw err;
      }

      track(holder, settleInto(holder, result), self);
    }

    self.RegisterDirect(symbol, name, thunk as unknown as IoCServiceConstructed);

    return () => {
      const bank = self.services.get(symbol);

      // Only remove the registration this call created, not a later re-registration.
      if (bank && bank.get(name) === (thunk as unknown)) {
        bank.delete(name);
      }

      if (spec.ctor) self.untrackCtor(spec.ctor, name, thunk);
    };
  }

  //#endregion
}
