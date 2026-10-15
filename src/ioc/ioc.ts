import {
  IoCActivationError,
  IoCCircularDependencyError,
  IoCContainerDisposedError,
  IoCDisposeError,
  IoCDuplicateRegistrationError,
  IoCLevelError,
  IoCModuleCycleError,
  IoCNotIsolatableError,
  IoCRegistrationError,
  IoCResolveTimeoutError,
  IoCScopeRequiredError,
  IoCSealedError,
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
  createModuleView,
  createView,
  currentFrame,
  framePath,
  IOC_CONTEXT,
  IOC_EXTERNAL,
  IOC_MODULE,
  IOC_OWNERS,
  IOC_SELF,
  type IoCDependencyRecord,
  type IoCHolder,
  type IoCKey,
  type IoCLifetime,
  type IoCRegistration,
  type IoCResolveFrame,
  isClassLike,
  isHolder,
  isOnActivePath,
  keyDescription,
  labelFor,
  nearestHolder,
  noop,
  releaseBuild,
  settleInto,
  waitPath,
  withFrame,
} from './internals.ts';
import type { IoCDependencyValue, IoCDependencyValues, IoCDerivedDependency } from './IoCDeps.ts';
import type { IoCModule, IoCModulesNeed, IoCModulesProvide } from './IoCModule.ts';
import { type IoCToken, isIoCToken } from './IoCToken.ts';

/** The code of a `warning` event: something went wrong that couldn't be thrown to anyone. */
export type IoCWarningCode =
  | 'IOC_LATE_DISPOSE_FAILED'
  | 'IOC_MODULE_DUPLICATE'
  | 'IOC_ROLLBACK_FAILED';

/**
 * What the `OnEvent` option receives:
 *
 * - `build`: a service was built (or failed to build), with how long it took;
 * - `resolve`: a `Resolve` call finished, with how long it took;
 * - `start` / `stop`: a module's `OnStart` / `OnStop` finished (or failed), with how long it took;
 * - `warning`: something failed where no caller could be told (see {@link IoCWarningCode}).
 */
export type IoCEvent =
  | { Type: 'build'; Service: string; Ms: number; Error?: unknown }
  | { Type: 'resolve'; Service: string; Ms: number; Error?: unknown }
  | { Type: 'start'; Module: string; Ms: number; Error?: unknown }
  | { Type: 'stop'; Module: string; Ms: number; Error?: unknown }
  | { Type: 'warning'; Code: IoCWarningCode; Message: string; Service?: string };

/** Where the container is in its lifecycle (see {@link IoCContainer.State}). */
export type IoCContainerState = 'idle' | 'starting' | 'started' | 'stopping' | 'disposed';

/**
 * Options for a container. Its scopes inherit them. With no options, the container is strict,
 * lazy, follows resolution chains across `await` where the runtime allows it, and fails anything
 * still pending after 30 seconds.
 */
export interface IoCContainerOptions {
  /**
   * The scope levels this application uses, outermost first (`['tenant', 'request']`). Scopes
   * created with `CreateScope({ Level })` and registrations made with `ScopeLevel` must name one
   * of them, and levels nest in this order.
   */
  Levels?: readonly string[];

  /**
   * Fails a resolve, a build during `Start()`/`Activate()`, or a module's `OnStart`/`OnStop` that
   * is still pending after this many milliseconds, with an `IoCResolveTimeoutError` listing what
   * it waits on, instead of waiting forever. Defaults to 30 000; `0` turns it off.
   */
  PendingTimeoutMs?: number;

  /**
   * How the container follows resolution chains across `await` when a factory resolves through a
   * container captured in a closure instead of its parameter, so a cycle through them throws
   * instead of hanging. By default it uses `AsyncLocalStorage` where the runtime provides one
   * (Node.js, Deno, Bun); `false` turns it off, and an `AsyncLocalStorage` you pass is used
   * instead. The container never imports `node:async_hooks`, so browser bundles are unaffected.
   */
  AsyncContext?: IoCAsyncContext | false;

  /** Receives build, resolve, start and stop timings and warnings (see {@link IoCEvent}). */
  OnEvent?: (event: IoCEvent) => void;

  /**
   * For tests: lifts module sealing (any registration may be replaced, decorated or unregistered)
   * and enables {@link IoCContainer.Override}.
   */
  Testing?: boolean;
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
  /** The key's description (the token description, or the class name). */
  Key: string;

  /** The registration name (`$default` when unnamed). */
  Name: string;

  /** `Key` or `Key[name]`, as used in error messages. */
  Label: string;

  /** How it was registered. */
  Kind: 'class' | 'factory' | 'value';

  /** The lifetime. */
  Lifetime: 'singleton' | 'transient' | 'scoped';

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

  /** For built singletons and scoped services: how long the last build took, in milliseconds. */
  BuildMs?: number;
}

/** What {@link IoCContainer.Describe} returns. */
export interface IoCDescription {
  /** The container's lifecycle state. */
  State: IoCContainerState;

  /** This container's scope level, if it is a scope created with one. */
  Level?: string;

  /** True for a scope (a container with a parent). */
  Scope: boolean;

  /** Every registration visible from this container, nearest first. */
  Services: IoCServiceDescription[];

  /**
   * The modules added here and in parents, in the order they were added, with their start layer
   * (modules of one layer start together), and how long `OnStart` took.
   */
  Modules: {
    Name: string;
    Requires: string[];
    Layer: number;
    Started: boolean;
    StartMs?: number;
    Depth: number;
  }[];
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

  /**
   * Replaces an existing registration on purpose. Without it, registering a key and name again
   * throws. A registration a module made can only be replaced by that module (or if it is a
   * default).
   */
  Replace?: boolean;

  /**
   * Makes the service scoped to a level declared in the `Levels` option: one instance in (and
   * disposed with) the nearest scope of that level, shared by every scope inside it. Resolving
   * it with no such scope above throws `IoCScopeRequiredError`.
   */
  ScopeLevel?: string;
};

/** A dependency key: a typed token, or a class (abstract classes included). */
export type IoCDependencyKey<T> = IoCToken<T, string> | IoCServiceKeyConstructor<T>;

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

// Timers and clocks exist in every supported runtime, but not in the plain ES lib the npm build
// compiles with.
const host = globalThis as unknown as {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  performance?: { now(): number };
  process?: { getBuiltinModule?(id: string): Indexable };
};

function now(): number {
  return host.performance?.now() ?? Date.now();
}

let defaultContext: IoCAsyncContext | null | undefined;

/** The runtime's `AsyncLocalStorage`, when it offers one without an import; created once. */
function runtimeAsyncContext(): IoCAsyncContext | undefined {
  if (defaultContext === undefined) {
    try {
      const Storage = host.process?.getBuiltinModule?.('node:async_hooks')?.AsyncLocalStorage;

      defaultContext = typeof Storage === 'function' ? new Storage() : null;
    } catch {
      defaultContext = null;
    }
  }

  return defaultContext ?? undefined;
}

/** Throws `IOC_INVALID_KEY` unless `key` is a token or a class. */
function checkKey(key: unknown): IoCKey {
  if (isClassLike(key) || isIoCToken(key)) return key as IoCKey;

  const kind = key === null
    ? 'null'
    : typeof key === 'function'
    ? 'function that is not a class'
    : typeof key === 'object'
    ? 'plain object'
    : typeof key;

  throw new IoCRegistrationError(
    `Keys must be tokens or classes, but a ${kind} was given. Create a token with ` +
      `IoCToken<T>('Name') and share it by importing it.`,
    'IOC_INVALID_KEY',
  );
}

function normalizeDependency(dep: unknown): IoCDependencyRecord {
  const mode = (dep as Indexable)?.['@fathym/ioc/derived'] as IoCDependencyRecord['mode'];

  if (mode) return { ...normalizeDependency((dep as Indexable).Dependency), mode };

  if (Array.isArray(dep)) {
    return { key: checkKey(dep[0]), name: (dep[1] as string) || DEFAULT_NAME };
  }

  return { key: checkKey(dep), name: DEFAULT_NAME };
}

/** Records that the factory running in `frame` resolved `key` + `name` (see `observed`). */
function observe(frame: IoCResolveFrame | undefined, key: IoCKey, name: string): void {
  const observed = frame && !frame.settled ? frame.reg?.observed : undefined;

  if (!observed) return;

  const label = labelFor(key, name);

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
  const key = dep.key as IoCServiceKey<unknown>;

  if (dep.mode === 'lazy') return () => ioc.Resolve(key, dep.name);

  if (dep.mode === 'all') return ioc.ResolveAll(key);

  return ioc.Resolve(key, dep.name);
}

function dependencyLabel(dep: IoCDependencyRecord): string {
  return labelFor(dep.key, dep.name);
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

/** An instance a container must dispose, and the holder that caches it (if any). */
interface IoCOwned {
  value: object;
  holder?: IoCHolder;
}

/** Removes a scope that was garbage-collected without being disposed from its parent's list. */
const scopeFinalizer = new FinalizationRegistry<
  { parent: WeakRef<IoCContainer>; ref: WeakRef<IoCContainer> }
>(({ parent, ref }) => {
  (parent.deref() as Indexable)?.children.delete(ref);
});

/** Thrown inside `Start()` when a layer of modules failed; turned into an `IoCStartError`. */
class LayerFailure {
  constructor(public readonly failures: { Module: string; Error: unknown }[]) {}
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

  /**
   * Registrations by key, then by name (this container's own; scopes see parents too).
   *
   * @ignore
   */
  protected readonly registrations: Map<IoCKey, Map<string, IoCRegistration>>;

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
   */
  protected readonly owned: IoCOwned[];

  /**
   * Keys declared with {@link IoCContainer.Expect}: provided elsewhere (often by each scope), so
   * `Validate()` doesn't report them as missing. Key, then names.
   *
   * @ignore
   */
  protected readonly expected: Map<IoCKey, Set<string>>;

  /** @ignore */
  protected disposed: boolean;

  /**
   * The options this container was created with (scopes share their root's).
   *
   * @ignore
   */
  protected readonly options: IoCContainerOptions;

  /**
   * The async context in use, if any (resolved once, from the options and the runtime).
   *
   * @ignore
   */
  protected readonly asyncContext?: IoCAsyncContext;

  /**
   * The modules added with `Use()`, in the order they were registered.
   *
   * @ignore
   */
  protected readonly modules: IoCModule[];

  /**
   * The layers of modules that started, in start order; stopped in reverse.
   *
   * @ignore
   */
  protected readonly startedLayers: IoCModule[][];

  /**
   * How long each started module's `OnStart` took.
   *
   * @ignore
   */
  protected readonly startMs: Map<IoCModule, number>;

  /**
   * The running or finished `Start()`.
   *
   * @ignore
   */
  protected starting?: Promise<void>;

  /**
   * Holders built while `Start()` runs, so a failed start can forget them.
   *
   * @ignore
   */
  protected startBuilds?: IoCHolder[];

  /**
   * The running `Dispose()`.
   *
   * @ignore
   */
  protected disposing?: Promise<void>;

  /** @ignore */
  protected state: IoCContainerState;

  /**
   * The level given to `CreateScope({ Level })`, if any.
   *
   * @ignore
   */
  protected level?: string;

  /**
   * Live child scopes, held weakly so a scope dropped without `Dispose()` can still be collected.
   *
   * @ignore
   */
  protected readonly children: Set<WeakRef<IoCContainer>>;

  /**
   * This scope's entry in its parent's `children`.
   *
   * @ignore
   */
  protected selfRef?: WeakRef<IoCContainer>;

  /**
   * Creates a container. Every option is optional: with none, the container is already strict,
   * lazy and protected against hangs.
   *
   * @param options Levels, timeouts, events and test mode.
   */
  constructor(options?: IoCContainerOptions) {
    this.options = { ...options };

    if (this.options.Levels) {
      const levels = this.options.Levels;

      if (new Set(levels).size !== levels.length || levels.some((l) => !l)) {
        throw new IoCRegistrationError('Levels must be distinct, non-empty names.');
      }

      this.options.Levels = Object.freeze([...levels]);
    }

    const timeout = this.options.PendingTimeoutMs;

    if (timeout !== undefined && (!(timeout >= 0) || !Number.isFinite(timeout))) {
      throw new IoCRegistrationError(
        'PendingTimeoutMs must be a finite number of milliseconds (0 turns it off).',
      );
    }

    this.asyncContext = this.options.AsyncContext === false
      ? undefined
      : this.options.AsyncContext ?? runtimeAsyncContext();

    this.registrations = new Map();
    this.scopedHolders = new Map();
    this.owned = [];
    this.expected = new Map();
    this.modules = [];
    this.startedLayers = [];
    this.startMs = new Map();
    this.children = new Set();
    this.disposed = false;
    this.state = 'idle';
  }

  /**
   * Where the container is in its lifecycle:
   *
   * - `idle`: created, or a `Start()` failed (and was rolled back);
   * - `starting`: `Start()` is running;
   * - `started`: `Start()` succeeded;
   * - `stopping`: `Dispose()` is running;
   * - `disposed`: done; every call but `Dispose()` throws.
   */
  public get State(): IoCContainerState {
    return this.self().state;
  }

  //#region Resolution

  /** Resolves a service by its token or class, optionally by name. */
  public async Resolve<K extends IoCServiceKey<unknown>>(
    key: K,
    name?: string,
  ): Promise<IoCServiceOf<K>> {
    const frame = this.frame();

    this.assertNotDisposed();

    const n = name || DEFAULT_NAME;

    if (!this.self().options.OnEvent) {
      const reg = this.lookup(checkKey(key), n, frame);

      observe(frame, key, n);

      return (await this.timed(
        reg.resolveIn(this.self(), frame),
        reg.label,
        reg.holder,
      )) as IoCServiceOf<K>;
    }

    const started = now();

    const label = labelFor(checkKey(key), n);

    try {
      const reg = this.lookup(key, n, frame);

      observe(frame, key, n);

      const result = await this.timed(reg.resolveIn(this.self(), frame), reg.label, reg.holder);

      this.emit({ Type: 'resolve', Service: label, Ms: now() - started });

      return result as IoCServiceOf<K>;
    } catch (err) {
      this.emit({ Type: 'resolve', Service: label, Ms: now() - started, Error: err });

      throw err;
    }
  }

  /** Resolves a service, or `undefined` when nothing is registered for it. */
  public async TryResolve<K extends IoCServiceKey<unknown>>(
    key: K,
    name?: string,
  ): Promise<IoCServiceOf<K> | undefined> {
    this.assertNotDisposed();

    return this.find(checkKey(key), name || DEFAULT_NAME)
      ? await this.Resolve(key, name)
      : undefined;
  }

  /**
   * Resolves every named registration for a key (including `$default`), nearest scope first
   * when a name is registered at several levels.
   */
  public async ResolveAll<K extends IoCServiceKey<unknown>>(key: K): Promise<IoCServiceOf<K>[]> {
    // Resolve through `this` so a factory parameter view keeps its resolution chain.
    return await Promise.all(this.Names(key).map((name) => this.Resolve(key, name)));
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
  public async ResolveNamed<K extends IoCServiceKey<unknown>>(
    key: K,
  ): Promise<Map<string, IoCServiceOf<K>>> {
    const names = this.Names(key);

    // Resolve through `this` so a factory parameter view keeps its resolution chain.
    const values = await Promise.all(names.map((name) => this.Resolve(key, name)));

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
   * const $Url = IoCToken<string, 'Url'>('Url');
   * const $Port = IoCToken<number, 'Port'>('Port');
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
  public Names(key: IoCServiceKey<unknown>): string[] {
    const names: string[] = [];

    const k = checkKey(key);

    for (const container of this.chain()) {
      for (const name of container.registrations.get(k)?.keys() ?? []) {
        if (!names.includes(name)) names.push(name);
      }
    }

    return names;
  }

  /** True when a registration exists for the key and name (in this container or its parents). */
  public Has(key: IoCServiceKey<unknown>, name?: string): boolean {
    return !!this.find(checkKey(key), name || DEFAULT_NAME);
  }

  /**
   * Builds every singleton registered in this container that isn't built yet, so configuration
   * errors surface at startup rather than on first use. Rejects with an `IoCActivationError` (an
   * `AggregateError`) naming every service that failed. Transient and scoped services are not
   * built: they belong to each resolve and to each scope. `Start()` calls it for you.
   *
   * @example Fail fast at startup
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Cache = IoCToken<Map<string, string>, 'Cache'>('Cache');
   *
   * const ioc = new IoCContainer().RegisterFactory($Cache, () => new Map());
   *
   * await ioc.Activate(); // builds Cache now; throws an IoCActivationError naming every failure
   * ```
   */
  public async Activate(): Promise<void> {
    const self = this.self();

    self.assertNotDisposed();

    const failures: { label: string; error: unknown }[] = [];

    const work: Promise<void>[] = [];

    for (const bank of self.registrations.values()) {
      for (const reg of bank.values()) {
        // Transients are built per resolve, and scoped services belong to the scopes that use them.
        if (reg.lifetime !== 'singleton') continue;

        work.push(
          Promise.resolve()
            .then(() => self.timed(reg.resolveIn(self, undefined), reg.label, reg.holder))
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
   * - `missing`: a declared dependency (`Deps`) that is not registered;
   * - `cycle`: a cycle between declared dependencies;
   * - `captive`: a service that depends, directly or through transients, on a shorter-lived one
   *   (a singleton on a scoped service, a tenant-level service on a request-level one), which it
   *   would capture forever;
   * - `arguments`: a class registered without `Deps` whose constructor takes parameters (it would
   *   be constructed with `undefined` arguments);
   * - `undeclared`: a module's service depending on a service from another module that the
   *   module neither `Requires` nor lists in `Needs`.
   *
   * Keys declared with {@link IoCContainer.Expect} count as provided. Factories without `Deps` are
   * opaque, so what they resolve is not checked; `Activate()` covers those by building
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
   * ioc.RegisterClass(Repo, { Deps: [Config] });
   *
   * ioc.Validate(); // throws IoCValidationError if anything is missing, cyclic or captive
   * ```
   */
  public Validate(options?: { Throw?: boolean }): IoCValidationIssue[] {
    const issues: IoCValidationIssue[] = [];

    const issue = (kind: IoCValidationIssue['Kind'], service: string, message: string) => {
      issues.push({ Kind: kind, Service: service, Message: message });
    };

    const registrations: IoCRegistration[] = [];

    for (const container of this.chain()) {
      for (const bank of container.registrations.values()) {
        for (const reg of bank.values()) registrations.push(reg);
      }
    }

    const resolveDep = (dep: IoCDependencyRecord) => this.find(dep.key, dep.name);

    const levels = this.self().options.Levels ?? [];

    /** Lifetimes rank from longest (0, singleton) to shortest; transients have no rank. */
    const rank = (reg: IoCRegistration): number | undefined => {
      if (reg.lifetime === 'singleton') return 0;

      if (reg.lifetime === 'transient') return undefined;

      return reg.scopeLevel === undefined ? levels.length + 1 : levels.indexOf(reg.scopeLevel) + 1;
    };

    const lifetimeName = (reg: IoCRegistration) =>
      reg.lifetime === 'scoped' && reg.scopeLevel !== undefined
        ? `${reg.scopeLevel}-scoped`
        : reg.lifetime;

    for (const reg of registrations) {
      const arity = reg.kind === 'class' && !reg.deps && reg.ctor ? constructorArity(reg.ctor) : 0;

      if (arity > 0) {
        issue(
          'arguments',
          reg.label,
          `${reg.label} is constructed without arguments, but its constructor declares ` +
            `${arity} parameter(s); register it with Deps or with a factory.`,
        );
      }

      for (const dep of reg.deps ?? []) {
        // Every registration of a key, possibly none: nothing to be missing.
        if (dep.mode === 'all') continue;

        if (!resolveDep(dep) && !this.isExpected(dep.key, dep.name)) {
          issue(
            'missing',
            reg.label,
            `${reg.label} depends on ${dependencyLabel(dep)}, which is not registered.`,
          );
        }
      }

      // Captives: what this service holds on to (through transients) must live at least as long.
      const own = rank(reg);

      if (own !== undefined) {
        const seen = new Set<IoCRegistration>();

        const visit = (from: IoCRegistration, via: string[]) => {
          for (const dep of from.deps ?? []) {
            if (dep.mode === 'all') continue;

            const target = resolveDep(dep);

            if (!target || seen.has(target)) continue;

            seen.add(target);

            const theirs = rank(target);

            if (theirs === undefined) {
              visit(target, [...via, target.label]);
            } else if (theirs > own) {
              issue(
                'captive',
                reg.label,
                `${lifetimeName(reg)} ${reg.label} depends on ${lifetimeName(target)} ` +
                  `${target.label}${via.length ? ` (through ${via.join(' -> ')})` : ''}; it ` +
                  `would keep one instance for its whole life. Give ${reg.label} a shorter ` +
                  `lifetime, or inject IoCLazy(...) and resolve it per use.`,
              );
            }
          }
        };

        visit(reg, []);
      }

      // Undeclared module dependencies: a module may only lean on modules it requires.
      if (reg.module) {
        const module = reg.module as IoCModule;

        for (const dep of reg.deps ?? []) {
          const target = resolveDep(dep);

          const from = target?.module as IoCModule | undefined;

          if (!from || from === module || requiresModule(module, from)) continue;

          if (listsNeed(module, dep)) continue;

          issue(
            'undeclared',
            reg.label,
            `${reg.label} (module '${module.Name}') depends on ${dependencyLabel(dep)} from ` +
              `module '${from.Name}', but '${module.Name}' neither requires '${from.Name}' nor ` +
              `lists ${dependencyLabel(dep)} in its Needs.`,
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
   * Declares keys that are registered somewhere else (each scope, like a per-request `$Request`),
   * so a typed container's `Deps` may name them and `Validate()` doesn't report them as missing.
   * Nothing is registered: resolving an expected key where nobody registered it still throws,
   * with a hint. Returns the same container.
   *
   * @example A key each request scope provides
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
   *   .RegisterClass(Handler, { Deps: [$Request], Lifetime: 'scoped' });
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

      let names = self.expected.get(key);

      if (!names) self.expected.set(key, names = new Set());

      names.add(name);
    }

    return this as unknown as IoCContainer<TKeys | IoCExpected<TDeps>>;
  }

  /**
   * Registers a class that the container constructs (`new clazz(...deps)`), keyed by the class
   * (or `options.Type`). Returns the container, typed with the new key, so registrations chain.
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

    const key = opts.Type === undefined ? clazz : checkKey(opts.Type);

    const deps = opts.Deps?.map(normalizeDependency);

    this.addRegistration({
      key,
      name: opts.Name || DEFAULT_NAME,
      kind: 'class',
      ctor: clazz,
      factory: deps
        ? async (ioc) => new clazz(...await Promise.all(deps.map((d) => resolveDependency(ioc, d))))
        : () => new clazz(),
      deps,
      options: opts,
      dispose: opts.Dispose as ((instance: unknown) => unknown) | undefined,
    });

    return this as unknown as IoCContainer<
      TKeys | ([TType] extends [never] ? IoCRegistered<C, TName> : IoCRegistered<TType, TName>)
    >;
  }

  /**
   * Registers a factory under a token or class key. The factory receives the container (use it
   * rather than a captured container, so scopes and cycle detection work) and, after it, the
   * services named in `Deps`. Returns the container, typed with the new key, so registrations
   * chain.
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

    const deps = opts.Deps?.map(normalizeDependency);

    const call = factory as (ioc: IoCContainer, ...deps: unknown[]) => unknown;

    this.addRegistration({
      key: checkKey(key),
      name: opts.Name || DEFAULT_NAME,
      kind: 'factory',
      factory: deps
        ? async (ioc) => call(ioc, ...await Promise.all(deps.map((d) => resolveDependency(ioc, d))))
        : call,
      deps,
      options: opts,
      dispose: opts.Dispose as ((instance: unknown) => unknown) | undefined,
    });

    return this as unknown as IoCContainer<TKeys | IoCRegistered<K, TName>>;
  }

  /**
   * Registers an existing value (any value, including functions and thenables) as a singleton.
   * The container never invokes it, and never disposes it unless given a `Dispose` callback.
   * Returns the container, typed with the new key, so registrations chain.
   */
  public RegisterValue<K extends IoCServiceKey<unknown>, const TName extends string = '$default'>(
    key: K,
    value: IoCServiceOf<K>,
    options?: {
      /** Registers under a name, so several values can share one key. */
      Name?: TName;

      /** Hands the value to the container: it is cleaned up this way when the container is disposed. */
      Dispose?: (value: IoCServiceOf<K>) => unknown;

      /** A default value that yields to any other registration (see `IoCServiceOptions.Default`). */
      Default?: boolean;

      /** Replaces an existing registration on purpose. */
      Replace?: boolean;
    },
  ): IoCContainer<TKeys | IoCRegistered<K, TName>> {
    // Values belong to whoever created them; no container disposes them unless asked to.
    if (!options?.Dispose && isDisposable(value) && !IOC_OWNERS.has(value)) {
      IOC_OWNERS.set(value, IOC_EXTERNAL);
    }

    this.addRegistration({
      key: checkKey(key),
      name: options?.Name || DEFAULT_NAME,
      kind: 'value',
      factory: () => value,
      value: { value },
      options: { Default: options?.Default, Replace: options?.Replace },
      dispose: options?.Dispose as ((instance: unknown) => unknown) | undefined,
    });

    return this as unknown as IoCContainer<TKeys | IoCRegistered<K, TName>>;
  }

  /**
   * Wraps the current registration for a key with `decorator` (logging, caching, retries…). The
   * decorated service keeps the original's lifetime; decorators applied in order wrap each
   * other. In a scope, decorating a parent's registration only affects the scope. A registration
   * a module made can only be decorated by that module (or if it is a default). Returns a
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
  public Decorate<K extends IoCServiceKey<unknown>>(
    key: K,
    decorator: (
      inner: IoCServiceOf<K>,
      ioc: IoCContainer,
    ) => IoCServiceOf<K> | Promise<IoCServiceOf<K>>,
    options?: { Name?: string },
  ): () => void {
    const self = this.self();

    self.assertNotDisposed();

    const name = options?.Name || DEFAULT_NAME;

    const k = checkKey(key);

    const original = self.lookup(k, name, undefined);

    const own = self.registrations.get(k)?.get(name);

    if (own) this.checkSealed(own, 'decorate');

    const decorate = (inner: IoCRegistration) => (ioc: IoCContainer) => {
      const value = inner.resolveIn((ioc as IoCContainer).self(), ioc.frame());

      return value instanceof Promise
        ? value.then((v) => decorator(v as IoCServiceOf<K>, ioc))
        : decorator(value as IoCServiceOf<K>, ioc);
    };

    const decorated = this.addRegistration({
      key: k,
      name,
      kind: 'factory',
      lifetime: original.lifetime,
      scopeLevel: original.scopeLevel,
      factory: decorate(original),
      // An isolated decorator wraps an isolated copy of what it decorates.
      fork: (owner) => decorate(original.fork(owner)),
      deps: original.deps,
      options: { Replace: true },
      sealChecked: true,
    });

    return () => {
      const bank = self.registrations.get(k);

      // Put back what this container had before, unless something else replaced the decorator.
      if (bank?.get(name) !== decorated) return;

      if (own) bank.set(name, own);
      else bank.delete(name);
    };
  }

  /**
   * Removes a registration from this container (not from parents). Returns whether one existed.
   * A registration a module made can only be removed by that module.
   */
  public Unregister(key: IoCServiceKey<unknown>, name?: string): boolean {
    const self = this.self();

    const k = checkKey(key);

    const n = name || DEFAULT_NAME;

    const bank = self.registrations.get(k);

    const reg = bank?.get(n);

    if (!bank || !reg) return false;

    this.checkSealed(reg, 'unregister');

    bank.delete(n);

    if (!bank.size) self.registrations.delete(k);

    return true;
  }

  //#endregion

  //#region Scopes and disposal

  /**
   * Creates a child scope. The scope resolves everything its parent can; `scoped` registrations
   * get one instance per scope, singletons stay shared with the parent, and registrations made
   * on the scope override the parent's for this scope only (handy for per-request services and
   * for test overrides). Dispose the scope when done (`await using scope = ioc.CreateScope()`)
   * to dispose the instances it created; disposing the parent disposes its live scopes too.
   *
   * Give a scope a `Level` declared in the `Levels` option (`'tenant'`, `'request'`, …) to host
   * the services registered with a matching `ScopeLevel`: they live in the nearest scope of that
   * level, so the scopes nested inside it share its instance.
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

    const level = options?.Level;

    if (level !== undefined) self.checkLevel(level, true);

    const scope = new IoCContainer<TKeys>({
      ...self.options,
      AsyncContext: self.asyncContext ?? false,
    });

    scope.parent = self;

    scope.level = level;

    scope.selfRef = new WeakRef(scope);

    self.children.add(scope.selfRef);

    scopeFinalizer.register(scope, { parent: new WeakRef(self), ref: scope.selfRef }, scope);

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
   * const ioc = new IoCContainer({ Levels: ['agent'] }).RegisterClass(Memory);
   *
   * await using agent = ioc.CreateScope({ Level: 'agent' }).Isolate(Memory);
   *
   * (await agent.Resolve(Memory)).notes.push('only mine');
   *
   * console.log((await ioc.Resolve(Memory)).notes.length); // 0
   * ```
   */
  public Isolate(
    ...keys: (IoCServiceKey<unknown> | readonly [IoCServiceKey<unknown>, string])[]
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
      const { key, name } = normalizeDependency(item);

      const reg = parent.lookup(key, name, undefined);

      if (reg.kind === 'value') {
        throw new IoCNotIsolatableError(reg.label, 'it is a value, which every scope shares as is');
      }

      self.store(reg.fork(self));
    }

    return this;
  }

  /**
   * For tests: replaces a registration with a value until the returned function is called, which
   * puts back exactly what was there before (or removes the override when nothing was). Only a
   * container created with `{ Testing: true }` (or its scopes) allows it; elsewhere it throws
   * `IoCSealedError`. Instances already built from the old registration keep what they were
   * given, so override before resolving the services that use it, or override in a scope and
   * resolve from there.
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Now = IoCToken<() => number, 'Now'>('Now');
   *
   * const ioc = new IoCContainer({ Testing: true }).RegisterValue($Now, () => Date.now());
   *
   * const restore = ioc.Override($Now, () => 0);
   *
   * console.log((await ioc.Resolve($Now))()); // 0
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

    this.assertNotModuleView('Override');

    if (!self.options.Testing) {
      throw new IoCSealedError(labelFor(k, name), undefined, 'override');
    }

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

  /**
   * Describes everything visible from this container as plain data: each registration's key,
   * name, kind, lifetime, level, module, declared and observed dependencies, whether it is
   * shadowed by a nearer scope, whether it is built and how long that took; plus the container's
   * state and its modules. Builds nothing. Use it for debugging, diagrams, health pages and
   * tooling.
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Url = IoCToken<string, 'Url'>('Url');
   *
   * class Repo {
   *   constructor(public url: string) {}
   * }
   *
   * const ioc = new IoCContainer()
   *   .RegisterValue($Url, 'kv://local')
   *   .RegisterClass(Repo, { Deps: [$Url] });
   *
   * for (const s of ioc.Describe().Services) {
   *   console.log(`${s.Label} (${s.Kind}, ${s.Lifetime}) -> ${s.Deps.join(', ') || 'nothing'}`);
   * }
   * ```
   */
  public Describe(): IoCDescription {
    const self = this.self();

    const services: IoCServiceDescription[] = [];

    const visible = new Set<IoCRegistration | string>();

    let depth = 0;

    const ids = new Map<IoCKey, number>();

    const idFor = (key: IoCKey, name: string) => {
      if (!ids.has(key)) ids.set(key, ids.size);

      return `${ids.get(key)}\u0000${name}`;
    };

    for (const container of self.chain()) {
      for (const [key, bank] of container.registrations) {
        for (const [name, reg] of bank) {
          const id = idFor(key, name);

          const holder = reg.lifetime === 'scoped' && container !== self
            ? self.scopedHolders.get(reg)
            : reg.holder;

          services.push({
            Key: keyDescription(key),
            Name: name,
            Label: reg.label,
            Kind: reg.kind,
            Lifetime: reg.lifetime,
            ScopeLevel: reg.scopeLevel,
            Default: !!reg.default,
            Module: reg.module?.Name,
            Depth: depth,
            Shadowed: visible.has(id),
            Deps: (reg.deps ?? []).map((d) => `${d.mode ? `${d.mode}:` : ''}${dependencyLabel(d)}`),
            Observed: [...reg.observed?.keys() ?? []],
            State: reg.lifetime !== 'transient' ? holder?.state ?? 'empty' : undefined,
            BuildMs: holder?.state === 'ready' ? holder.buildMs : undefined,
          });

          visible.add(id);
        }
      }

      depth++;
    }

    const modules: IoCDescription['Modules'] = [];

    depth = 0;

    for (const container of self.chain()) {
      const layers = container.layers();

      layers.forEach((layer, index) => {
        for (const module of layer) {
          modules.push({
            Name: module.Name,
            Requires: (module.Requires ?? []).map((m) => m.Name),
            Layer: index,
            Started: container.startedLayers.some((l) => l.includes(module)),
            StartMs: container.startMs.get(module),
            Depth: depth,
          });
        }
      });

      depth++;
    }

    return {
      State: self.state,
      Level: self.level,
      Scope: !!self.parent,
      Services: services,
      Modules: modules,
    };
  }

  /**
   * Shuts the container down: stops the modules (`OnStop`, in reverse start order), disposes the
   * live scopes created from it (deepest first), then disposes, in reverse creation order, the
   * instances it created that implement `Symbol.asyncDispose` or `Symbol.dispose` (or that were
   * registered with a `Dispose` callback). Values registered with `RegisterValue` and transient
   * instances are never disposed. If `Start()` is running, it waits for the running step to
   * finish first. Errors are collected into an `IoCDisposeError`.
   */
  public async Dispose(): Promise<void> {
    const self = this.self();

    this.assertNotModuleView('Dispose');

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
   * runs against a module view of this container. A module already added here or in a parent is
   * skipped, so shared requirements are registered once. Registrations a module makes belong to
   * it (see {@link IoCModule}). Modules must be added before {@link IoCContainer.Start}.
   *
   * On a {@link IoCContainer.Typed typed container}, the modules' provided keys are added to the
   * registry, and the call doesn't compile unless the registry covers what they need.
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
   *   Register: (ioc) => ioc.RegisterFactory($Client, (_c, url) => ({ url }), { Deps: [$Url] }),
   * };
   *
   * const ioc = new IoCContainer().Use(Client); // registers Config, then Client
   *
   * console.log((await ioc.Resolve($Client)).url); // kv://local
   * ```
   */
  // deno-lint-ignore no-explicit-any
  public Use<const TModules extends readonly IoCModule<any, any>[]>(
    ...modules: TModules & IoCCheckNeeds<TKeys, TModules>
  ): IoCContainer<TKeys | IoCModulesProvide<TModules>> {
    const self = this.self();

    this.assertNotModuleView('Use');

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

      if (self.starting || self.state !== 'idle') {
        throw new IoCRegistrationError(
          `Module '${module.Name}' was added after Start(); add modules before starting the ` +
            `container, or give late plugins a scope: ioc.CreateScope().Use(plugin).`,
        );
      }

      if (self.modules.some((m) => m.Name === module.Name)) {
        self.emit({
          Type: 'warning',
          Code: 'IOC_MODULE_DUPLICATE',
          Message: `Two different modules are named '${module.Name}'; both were added.`,
          Service: module.Name,
        });
      }

      module.Register(createModuleView(self, module));

      self.modules.push(module);
    };

    for (const module of modules as readonly IoCModule[]) visit(module, []);

    return this as unknown as IoCContainer<TKeys | IoCModulesProvide<TModules>>;
  }

  /**
   * Starts the container:
   *
   * 1. checks the wiring with `Validate()` (skip it with `{ Validate: false }`);
   * 2. builds every singleton (`Activate()`);
   * 3. runs the modules' `OnStart`, layer by layer: a module starts after the modules it
   *    requires, and modules that don't depend on each other start at the same time.
   *
   * If anything fails, the started modules are stopped, everything built during this `Start()`
   * is disposed and forgotten, the container goes back to `idle`, and `Start()` throws
   * (`IoCValidationError`, `IoCActivationError` or {@link IoCStartError}). It can then be called
   * again. Calling it again after it succeeded does nothing. `Dispose()` (or `await using`) runs
   * the started modules' `OnStop` before disposing anything.
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

    this.assertNotModuleView('Start');

    self.assertNotDisposed();

    if (self.disposing) return Promise.reject(new IoCContainerDisposedError());

    if (!self.starting) {
      const starting = self.startNow(options);

      self.starting = starting;

      // A failed start can be retried once its cause is fixed.
      starting.catch(() => {
        if (self.starting === starting) self.starting = undefined;
      });
    }

    return self.starting;
  }

  //#endregion

  //#region Internals

  /**
   * Applies `PendingTimeoutMs` to a pending value (a resolve, a startup build, an `OnStart`).
   *
   * @ignore
   */
  protected timed(value: unknown, label: string, holder?: IoCHolder): unknown {
    const ms = this.self().options.PendingTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!ms || !(value instanceof Promise)) return value;

    let timer: unknown;

    const timeout = new Promise<never>((_, reject) => {
      timer = host.setTimeout(() => {
        reject(new IoCResolveTimeoutError(label, ms, pendingLabels(holder)));
      }, ms);
    });

    return Promise.race([value, timeout]).finally(() => host.clearTimeout(timer));
  }

  /**
   * Reports an event to the `OnEvent` option, if one was given. A throwing listener never breaks
   * the container.
   *
   * @ignore
   */
  protected emit(event: IoCEvent): void {
    try {
      this.self().options.OnEvent?.(event);
    } catch {
      // The listener's problem; never the container's.
    }
  }

  /**
   * The modules of this container grouped into start layers: a module's layer is one more than
   * the deepest layer of the modules it requires (here). Within a layer, modules keep the order
   * they were added in.
   *
   * @ignore
   */
  protected layers(): IoCModule[][] {
    const layerOf = new Map<IoCModule, number>();

    const layerFor = (module: IoCModule): number => {
      const known = layerOf.get(module);

      if (known !== undefined) return known;

      let layer = 0;

      for (const required of module.Requires ?? []) {
        if (this.modules.includes(required)) layer = Math.max(layer, layerFor(required) + 1);
      }

      layerOf.set(module, layer);

      return layer;
    };

    const layers: IoCModule[][] = [];

    for (const module of this.modules) (layers[layerFor(module)] ??= []).push(module);

    return layers.filter(Boolean);
  }

  /**
   * Runs `Start()` once.
   *
   * @ignore
   */
  protected async startNow(options?: { Validate?: boolean }): Promise<void> {
    this.state = 'starting';

    const mark = this.owned.length;

    this.startBuilds = [];

    try {
      if (options?.Validate !== false) this.Validate();

      await this.Activate();

      for (const layer of this.layers()) {
        if (this.disposing) throw new IoCContainerDisposedError();

        const failures: { Module: string; Error: unknown }[] = [];

        const started: IoCModule[] = [];

        await Promise.all(layer.map(async (module) => {
          const begin = now();

          try {
            await this.timed(
              module.OnStart?.(createModuleView(this, module)),
              `Module '${module.Name}' OnStart`,
            );

            const ms = now() - begin;

            this.startMs.set(module, ms);

            started.push(module);

            this.emit({ Type: 'start', Module: module.Name, Ms: ms });
          } catch (err) {
            failures.push({ Module: module.Name, Error: err });

            this.emit({ Type: 'start', Module: module.Name, Ms: now() - begin, Error: err });
          }
        }));

        // Keep module order within the layer, for stop order and for errors.
        this.startedLayers.push(layer.filter((m) => started.includes(m)));

        if (failures.length) {
          const order = (name: string) => layer.findIndex((m) => m.Name === name);

          throw new LayerFailure(failures.sort((a, b) => order(a.Module) - order(b.Module)));
        }
      }

      if (this.disposing) throw new IoCContainerDisposedError();

      this.state = 'started';
    } catch (err) {
      // Dispose() is running: it stops and disposes everything; nothing to roll back here.
      if (this.disposing) throw new IoCContainerDisposedError();

      const rollback = [...await this.stopModules(), ...await this.forgetSince(mark)];

      this.state = 'idle';

      if (err instanceof LayerFailure) {
        const [first] = err.failures;

        throw new IoCStartError(first.Module, first.Error, rollback, err.failures);
      }

      for (const error of rollback) {
        this.emit({
          Type: 'warning',
          Code: 'IOC_ROLLBACK_FAILED',
          Message: `Cleaning up after a failed Start() failed: ${error}`,
        });
      }

      throw err;
    } finally {
      this.startBuilds = undefined;
    }
  }

  /**
   * Disposes the instances created since `mark` and empties the holders built during `Start()`,
   * so a retried `Start()` builds them again.
   *
   * @ignore
   */
  protected async forgetSince(mark: number): Promise<unknown[]> {
    const errors: unknown[] = [];

    for (const entry of this.owned.splice(mark).reverse()) {
      try {
        await disposeOne(entry.value);
      } catch (err) {
        errors.push(err);
      }
    }

    for (const holder of this.startBuilds ?? []) {
      if (holder.state !== 'ready') continue;

      holder.state = 'empty';
      holder.value = undefined;
      holder.buildMs = undefined;
    }

    return errors;
  }

  /**
   * Runs `OnStop` for the started modules: layers in reverse, the modules of a layer together.
   * Returns the errors.
   *
   * @ignore
   */
  protected async stopModules(): Promise<unknown[]> {
    const errors: unknown[] = [];

    for (const layer of this.startedLayers.splice(0).reverse()) {
      await Promise.all(layer.map(async (module) => {
        const begin = now();

        try {
          await this.timed(
            module.OnStop?.(createModuleView(this, module)),
            `Module '${module.Name}' OnStop`,
          );

          this.emit({ Type: 'stop', Module: module.Name, Ms: now() - begin });
        } catch (err) {
          errors.push(err);

          this.emit({ Type: 'stop', Module: module.Name, Ms: now() - begin, Error: err });
        }
      }));
    }

    this.startMs.clear();

    return errors;
  }

  /**
   * True when `module` was added to this container or a parent.
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
   * Waits for a running `Start()`, stops the modules, disposes the live child scopes, then the
   * owned instances.
   *
   * @ignore
   */
  protected async disposeNow(): Promise<void> {
    const self = this.self();

    self.state = 'stopping';

    // A running Start() stops at its next step (it sees `disposing`); let that step finish so
    // no module is left half-started.
    await self.starting?.catch(noop);

    // Modules stop while their services are still alive.
    const errors: unknown[] = await self.stopModules();

    // Then the scopes created from this container, each disposing its own scopes first.
    const scopes = [...self.children].map((ref) => ref.deref()).filter((s) => !!s);

    const results = await Promise.allSettled(scopes.map((scope) => scope.Dispose()));

    for (const result of results) {
      if (result.status === 'rejected') errors.push(result.reason);
    }

    self.disposed = true;

    self.state = 'disposed';

    for (const { value } of self.owned.splice(0).reverse()) {
      try {
        await disposeOne(value);
      } catch (err) {
        errors.push(err);
      }
    }

    if (self.parent && self.selfRef) {
      self.parent.children.delete(self.selfRef);

      scopeFinalizer.unregister(self);
    }

    self.children.clear();
    self.scopedHolders.clear();
    self.registrations.clear();

    if (errors.length) {
      throw new IoCDisposeError(errors);
    }
  }

  /**
   * The resolution frame a call continues: the view's frame, else the running factory's, else
   * the async context's.
   *
   * @ignore
   */
  protected frame(): IoCResolveFrame | undefined {
    const frame = (this as Indexable)[IOC_CONTEXT] ?? currentFrame();

    if (frame) return frame;

    // A captured container used after an `await`: the async context still knows the chain.
    const stored = this.self().asyncContext?.getStore() as IoCResolveFrame | undefined;

    return stored && !stored.settled && typeof stored.label === 'string' ? stored : undefined;
  }

  /**
   * The real container behind a view (or this container).
   *
   * @ignore
   */
  protected self(): IoCContainer {
    return (this as Indexable)[IOC_SELF] ?? this;
  }

  /**
   * The module a module view acts as, if this is one.
   *
   * @ignore
   */
  protected currentModule(): IoCModule | undefined {
    return (this as Indexable)[IOC_MODULE];
  }

  /**
   * Throws when a module view calls a method meant for the application.
   *
   * @ignore
   */
  protected assertNotModuleView(method: string): void {
    const module = this.currentModule();

    if (!module) return;

    throw new IoCRegistrationError(
      `Module '${module.Name}' called ${method}(), which only the application can call. ` +
        (method === 'Use'
          ? `List the modules a module needs in its Requires instead.`
          : `Modules receive a view of the container for registering and resolving.`),
    );
  }

  /**
   * Throws `IoCSealedError` when the caller may not change `reg`: only the module that made it
   * may, unless it is a default or the container is in testing mode.
   *
   * @ignore
   */
  protected checkSealed(
    reg: IoCRegistration,
    action: 'replace' | 'decorate' | 'unregister',
  ): void {
    if (!reg.module || reg.default || this.self().options.Testing) return;

    if (reg.module === this.currentModule()) return;

    throw new IoCSealedError(reg.label, reg.module.Name, action);
  }

  /**
   * Throws `IoCLevelError` for a level that isn't declared, or (for a new scope) that doesn't
   * nest below the levels above it.
   *
   * @ignore
   */
  protected checkLevel(level: string, forScope: boolean): void {
    const levels = this.self().options.Levels ?? [];

    const index = levels.indexOf(level);

    if (index < 0) {
      throw new IoCLevelError(
        level,
        levels.length
          ? `Scope level '${level}' is not declared; the declared levels are: ${levels.join(', ')}.`
          : `Scope level '${level}' is not declared; declare the levels this application uses ` +
            `with new IoCContainer({ Levels: ['tenant', 'request'] }).`,
      );
    }

    if (!forScope) return;

    for (const c of this.chain()) {
      if (c.level !== undefined && levels.indexOf(c.level) >= index) {
        throw new IoCLevelError(
          level,
          `A '${level}' scope can't be created inside a '${c.level}' scope; levels nest in the ` +
            `declared order: ${levels.join(' > ')}.`,
        );
      }
    }
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
   * True when `key` + `name` was declared with `Expect()` here or in a parent.
   *
   * @ignore
   */
  protected isExpected(key: IoCKey, name: string): boolean {
    for (const c of this.chain()) {
      if (c.expected.get(key)?.has(name)) return true;
    }

    return false;
  }

  /**
   * Records an instance this container created, for disposal. The first container to create an
   * instance owns it: an instance that already has an owner (returned again by a decorator or an
   * alias factory, or a value given to `RegisterValue`) is never owned twice. An instance that
   * arrives after this container was disposed (its build was still in flight) is disposed now.
   *
   * @ignore
   */
  protected trackOwned(value: unknown, holder?: IoCHolder): void {
    if (!isDisposable(value) || IOC_OWNERS.has(value)) return;

    const self = this.self();

    IOC_OWNERS.set(value, self);

    if (!self.disposed) {
      self.owned.push({ value, holder });
      return;
    }

    disposeOne(value).catch((err) =>
      self.emit({
        Type: 'warning',
        Code: 'IOC_LATE_DISPOSE_FAILED',
        Message: `An instance that finished building after Dispose() failed to dispose: ${err}`,
      })
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
   * undefined when this container is the owner.
   *
   * @ignore
   */
  protected scopedHolderFor(reg: IoCRegistration): IoCHolder | undefined {
    if (reg.owner === this) return undefined;

    let holder = this.scopedHolders.get(reg);

    if (!holder) {
      holder = { state: 'empty' };
      this.scopedHolders.set(reg, holder);
    }

    return holder;
  }

  /**
   * Finds the registration for a key, nearest scope first. Never mutates.
   *
   * @ignore
   */
  protected find(key: IoCKey, name: string): IoCRegistration | undefined {
    for (let c: IoCContainer | undefined = this.self(); c; c = c.parent) {
      const reg = c.registrations.get(key)?.get(name);

      if (reg) return reg;
    }

    return undefined;
  }

  /**
   * Like `find`, but throws {@link IoCServiceNotFoundError} when nothing is registered.
   *
   * @ignore
   */
  protected lookup(
    key: IoCKey,
    name: string,
    frame: IoCResolveFrame | undefined,
  ): IoCRegistration {
    const found = this.find(key, name);

    if (found) return found;

    throw new IoCServiceNotFoundError(
      keyDescription(key),
      name,
      this.Names(key as IoCServiceKey<unknown>),
      framePath(frame),
      this.isExpected(key, name)
        ? 'It is declared with Expect(); register it on the container or scope that provides it.'
        : undefined,
    );
  }

  /**
   * Stores a registration in this container.
   *
   * @ignore
   */
  protected store(reg: IoCRegistration): void {
    let bank = this.registrations.get(reg.key);

    if (!bank) this.registrations.set(reg.key, bank = new Map());

    bank.set(reg.name, reg);
  }

  /**
   * Creates and stores a registration. Returns it, or the registration already in place when a
   * default yields to it.
   *
   * @ignore
   */
  protected addRegistration(spec: {
    key: IoCKey;
    name: string;
    kind: IoCRegistration['kind'];
    ctor?: AnyFunction;
    factory: (ioc: IoCContainer) => unknown;
    deps?: readonly IoCDependencyRecord[];
    dispose?: (instance: unknown) => unknown;
    options: IoCServiceOptions;
    /** A value registration: the value, already "built". */
    value?: { value: unknown };
    /** Set by `Decorate`, which checks sealing itself. */
    sealChecked?: boolean;
    /** Overrides the lifetime from the options (`Decorate` keeps the original's). */
    lifetime?: IoCLifetime;
    /** Overrides the level from the options. */
    scopeLevel?: string;
    /** Makes the factory for an isolated copy owned by `owner` (default: the same factory). */
    fork?: (owner: IoCContainer) => (ioc: IoCContainer) => unknown;
    /** Create the registration without checks or storing it. */
    detached?: boolean;
  }): IoCRegistration {
    const self = this.self();

    self.assertNotDisposed();

    const { key, name, factory, options } = spec;

    const label = labelFor(key, name);

    const scopeLevel = spec.scopeLevel ?? options.ScopeLevel;

    if (options.ScopeLevel !== undefined && options.Lifetime === 'transient') {
      throw new IoCRegistrationError(
        `${label} can't be transient and bound to the '${options.ScopeLevel}' level; a ` +
          `ScopeLevel makes it scoped.`,
      );
    }

    const lifetime: IoCLifetime = spec.lifetime ??
      (scopeLevel !== undefined ? 'scoped' : options.Lifetime ?? 'singleton');

    if (scopeLevel !== undefined && !spec.detached) self.checkLevel(scopeLevel, false);

    const existing = self.registrations.get(key)?.get(name);

    if (existing && !spec.detached) {
      if (options.Default) {
        // A default yields to whatever is already registered, unless that is a default too.
        if (!existing.default) return existing;

        this.checkSealed(existing, 'replace');
      } else if (!spec.sealChecked) {
        this.checkSealed(existing, 'replace');

        if (!options.Replace && !existing.default) {
          throw new IoCDuplicateRegistrationError(label);
        }
      }
    }

    // A default also yields to a registration in a parent (a framework default in a plugin scope).
    if (options.Default && !existing && !spec.detached) {
      const inherited = self.parent?.find(key, name);

      if (inherited && !inherited.default) return inherited;
    }

    const holder: IoCHolder | undefined = lifetime === 'transient' ? undefined : { state: 'empty' };

    const owns = spec.kind !== 'value' || !!spec.dispose;

    const { dispose } = spec;

    const module = this.currentModule();

    /** Hands an instance to its owner: the `Dispose` option's cleanup, else the instance itself. */
    const own = (tracker: IoCContainer, value: unknown, h?: IoCHolder) => {
      if (!dispose) return tracker.trackOwned(value, h);

      const isObject = (typeof value === 'object' || typeof value === 'function') && value !== null;

      // An instance someone else already owns is theirs to clean up.
      if (isObject && IOC_OWNERS.has(value)) return;

      if (isObject) IOC_OWNERS.set(value, tracker.self());

      tracker.trackOwned({ [Symbol.asyncDispose]: async () => await dispose(value) }, h);
    };

    /**
     * Invokes the factory as one frame of a resolution chain. Factories receive a view of
     * `container` that carries the chain, so resolves made through the parameter (even after an
     * `await`) take part in cycle detection.
     */
    const run = (
      container: IoCContainer,
      parent: IoCResolveFrame | undefined,
      frameKey: object,
    ) => {
      const frame: IoCResolveFrame = { key: frameKey, label, parent, settled: false, reg };

      if (isHolder(frameKey)) frameKey.building = frame;

      let result: unknown;

      const begin = now();

      const done = (error?: { error: unknown }) => {
        frame.settled = true;

        const ms = now() - begin;

        if (error) frame.failed = error;
        else if (isHolder(frameKey)) frameKey.buildMs = ms;

        if (container.options.OnEvent) {
          container.emit(
            error
              ? { Type: 'build', Service: label, Ms: ms, Error: error.error }
              : { Type: 'build', Service: label, Ms: ms },
          );
        }
      };

      try {
        const arg = createView(container, frame) as IoCContainer;

        const context = container.asyncContext;

        result = context
          ? context.run(frame, () => withFrame(frame, () => factory(arg)))
          : withFrame(frame, () => factory(arg));
      } catch (err) {
        done({ error: err });
        throw err;
      }

      if (result instanceof Promise) {
        return result.then(
          (value) => {
            done();
            return value;
          },
          (err) => {
            done({ error: err });
            throw err;
          },
        );
      }

      done();

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

      // A failed Start() forgets what it built.
      tracker.startBuilds?.push(h);

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
        own(tracker, result, h);
      } else if (result instanceof Promise) {
        result.then((value) => own(tracker, value, h), noop);
      }

      return result;
    };

    const reg: IoCRegistration = {
      key,
      name,
      lifetime,
      kind: spec.kind,
      ctor: spec.ctor,
      owner: self,
      module,
      holder,
      label,
      deps: spec.deps,
      default: options.Default || undefined,
      scopeLevel,
      observed: new Map(),
      fork(owner: object): IoCRegistration {
        const target = owner as IoCContainer;

        return target.addRegistration({
          ...spec,
          factory: spec.fork ? spec.fork(target) : factory,
          options: { ...options, Default: undefined, Replace: true },
          lifetime,
          scopeLevel,
          detached: true,
        });
      },
      resolveIn(container: object, frame?: IoCResolveFrame): unknown {
        const c = container as IoCContainer;

        if (!holder) {
          if (isOnActivePath(frame, reg)) {
            throw new IoCCircularDependencyError([...framePath(frame), label]);
          }

          const abandoned = abandonedBy(frame);

          if (abandoned) throw abandoned.error;

          // Transient instances belong to whoever resolved them; the container never disposes them.
          return run(c, frame, reg);
        }

        if (lifetime === 'scoped' && scopeLevel !== undefined) {
          // The nearest scope of the required level owns the instance.
          const site = c.scopedSiteFor(reg);

          if (!site) throw new IoCScopeRequiredError(label, scopeLevel);

          const scoped = site.scopedHolderFor(reg);

          return scoped
            ? fromHolder(scoped, site, site, frame)
            : fromHolder(holder, self, self, frame);
        }

        if (lifetime === 'scoped') {
          // One instance per child scope, built against (and disposed by) that scope.
          const scoped = c.scopedHolderFor(reg);

          if (scoped) return fromHolder(scoped, c, c, frame);

          // Resolving where it was registered: from the root, it would silently act as one
          // shared instance.
          if (!self.parent) throw new IoCScopeRequiredError(label);
        }

        // Singletons always build against their owner, never against whoever resolved them.
        return fromHolder(holder, self, self, frame);
      },
    };

    if (spec.value && holder) {
      // A value is already "built".
      holder.state = 'ready';
      holder.value = spec.value.value;

      if (dispose) own(self, spec.value.value, holder);
    }

    if (!spec.detached) self.store(reg);

    return reg;
  }

  //#endregion
}

/** True when `module` requires `other`, directly or through the modules it requires. */
function requiresModule(module: IoCModule, other: IoCModule, seen = new Set<IoCModule>()): boolean {
  for (const required of module.Requires ?? []) {
    if (required === other) return true;

    if (seen.has(required)) continue;

    seen.add(required);

    if (requiresModule(required, other, seen)) return true;
  }

  return false;
}

/** True when `module` lists `dep` (key and name) in its `Needs`. */
function listsNeed(module: IoCModule, dep: IoCDependencyRecord): boolean {
  return (module.Needs ?? []).some((need) => {
    const { key, name } = normalizeDependency(need);

    return key === dep.key && name === dep.name;
  });
}
