import {
  IoCAccessError,
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
  abortFrame,
  activeHolders,
  afterCommit,
  type AnyFunction,
  asModule,
  atomically,
  attachBuild,
  constructorArity,
  createAborter,
  createView,
  crossesInferred,
  currentFrame,
  currentModule as activeModule,
  frameAborter,
  framePath,
  IOC_CONTEXT,
  IOC_EXTERNAL,
  IOC_OWNERS,
  IOC_SELF,
  type IoCAborter,
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
  recordUndo,
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
  | 'IOC_ROLLBACK_FAILED'
  | 'IOC_DEFAULT_REPLACED'
  | 'IOC_MODULE_OVERRIDDEN'
  | 'IOC_UNDECLARED_DEPENDENCY';

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
  | { Type: 'health'; Module: string; Ms: number; Healthy: boolean; Error?: unknown }
  | { Type: 'warning'; Code: IoCWarningCode; Message: string; Service?: string };

/**
 * The `AbortSignal` a factory or `OnStart` receives through `ioc.Signal`. It is the platform's
 * `AbortSignal` type where one is declared (DOM or Node.js types), else the part of it the
 * container guarantees.
 */
export type IoCAbortSignal = typeof globalThis extends { AbortSignal: { prototype: infer S } } ? S
  : {
    /** Whether the container gave up on the work. */
    readonly aborted: boolean;

    /** Why: the timeout, rollback or disposal error. */
    readonly reason: unknown;

    /** Throws `reason` when aborted. */
    throwIfAborted(): void;

    /** Calls `listener` when the signal aborts. */
    addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;

    /** Removes a listener added with `addEventListener`. */
    removeEventListener(type: 'abort', listener: () => void): void;
  };

/** One module's result in an {@link IoCHealthReport}. */
export interface IoCModuleHealth {
  /** The module's name. */
  readonly Module: string;

  /** False when its `Health` threw, returned `false`, or timed out. */
  readonly Healthy: boolean;

  /** How long the check took, in milliseconds. */
  readonly Ms: number;

  /** What its `Health` threw (an `IoCResolveTimeoutError` when it timed out). */
  readonly Error?: unknown;
}

/** What {@link IoCContainer.Health} reports. */
export interface IoCHealthReport {
  /** True when the container has started and every module's `Health` passed: ready for work. */
  readonly Healthy: boolean;

  /** The container's lifecycle state when the checks finished. */
  readonly State: IoCContainerState;

  /** The started modules that declare `Health`, in start order. Empty unless started. */
  readonly Modules: readonly IoCModuleHealth[];
}

/** Options for {@link IoCContainer.Health}. */
export interface IoCHealthOptions {
  /**
   * How long each module's `Health` may take, in milliseconds (default 5000; 0 for no limit).
   * Keep it below your probe's own timeout, so the report, not the probe, names the slow module.
   */
  readonly TimeoutMs?: number;
}

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
   * container captured in a closure instead of its parameter, so errors keep their resolution
   * path and `Describe()` its observed dependencies. Such a chain is only presumed (a callback a
   * factory started looks the same), so it never reports a cycle: a real one fails at
   * `PendingTimeoutMs`, naming what is pending. Resolve through the factory's parameter to have
   * cycles reported at once. By default it uses `AsyncLocalStorage` where the runtime provides one
   * (Node.js, Deno, Bun); `false` turns it off, and an `AsyncLocalStorage` you pass is used
   * instead. The container never imports `node:async_hooks`, so browser bundles are unaffected.
   */
  AsyncContext?: IoCAsyncContext | false;

  /** Receives build, resolve, start and stop timings and warnings (see {@link IoCEvent}). */
  OnEvent?: (event: IoCEvent) => void;

  /**
   * Encapsulates modules: each can resolve only what it declares (see `IoCModule.Encapsulated`).
   * `true` for every module, or a function choosing which (`(m) => m.Name.startsWith('partner:')`).
   * A module's own `Encapsulated` setting wins.
   */
  EncapsulateModules?: boolean | ((module: IoCModule) => boolean);

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
   * throws. A module may replace only its own registrations and defaults; the application may
   * replace any.
   */
  Replace?: boolean;

  /**
   * Overrides the container's `PendingTimeoutMs` for this service: its builds (also during
   * `Start()`) and resolves fail after this many milliseconds (`0` turns it off). For the one
   * slow service, such as a migration, without raising the limit for everything else.
   */
  TimeoutMs?: number;

  /**
   * For singletons: build it on first resolve only, never in `Start()` or `Activate()`. For
   * resources only some code paths need (a CLI command's client, an optional integration), so
   * startup doesn't open them. `Validate()` still checks its wiring.
   */
  OnDemand?: boolean;

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

const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;

const MAX_TIMEOUT_MS = 2_147_483_647;

const MODULE_TIMEOUT_HINT = `Something it awaits may never settle (a connection, a lock); set ` +
  `the module's TimeoutMs if it is just slow.`;

const HEALTH_TIMEOUT_HINT = `Something it checks may never answer; pass Health() a longer ` +
  `TimeoutMs if it is just slow.`;

const DISPOSE_TIMEOUT_HINT = `Its cleanup (Symbol.asyncDispose, or the Dispose option) may never ` +
  `settle.`;

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

/** Throws unless `ms` is undefined or a finite, non-negative number of milliseconds. */
function checkTimeout(ms: number | undefined, option: string): void {
  // Timers overflow above 2^31 - 1 ms (about 24.8 days) and would fire at once.
  if (ms !== undefined && (!(ms >= 0) || !(ms <= MAX_TIMEOUT_MS))) {
    throw new IoCRegistrationError(
      `${option} must be a number of milliseconds from 0 (off) to 2147483647 (about 24.8 days).`,
    );
  }
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

/**
 * Records that the factory running in `frame` resolved `key` + `name` (see `observed`). Returns
 * the registration the first time, else `undefined`.
 */
function observe(
  frame: IoCResolveFrame | undefined,
  key: IoCKey,
  name: string,
): IoCRegistration | undefined {
  while (frame?.inferred) frame = frame.parent;

  const reg = frame && !frame.settled ? frame.reg : undefined;

  if (!reg?.observed) return undefined;

  let names = reg.observed.get(key);

  if (!names) reg.observed.set(key, names = new Set());

  if (names.has(name)) return undefined;

  names.add(name);

  return reg;
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

/**
 * How the container calls a registration's factory: with the view the factory sees, plus (for the
 * container's own wrappers, never user code) the container it builds on and its frame.
 */
type IoCFactory = (ioc: IoCContainer, container: IoCContainer, frame: IoCResolveFrame) => unknown;

/** An instance a container must dispose, the holder that caches it (if any), and its label. */
interface IoCOwned {
  value: object;
  holder?: IoCHolder;
  label: string;
}

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
   * Every module that registered each key, including a default the application (or another
   * default) later replaced or kept out: the module still provides the key to the modules that
   * require it, for `Validate()`'s `undeclared` check and for encapsulated modules.
   *
   * @ignore
   */
  protected readonly declarers: Map<IoCKey, Map<string, Set<IoCModule>>>;

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
   * The signals of the `OnStart` and `Health` calls running now, aborted if `Dispose()` comes.
   *
   * @ignore
   */
  protected readonly hookAborters: Set<IoCAborter>;

  /**
   * The factories running in this container (builds it owns, and transients resolved through
   * it), so `Dispose()` can tell them to stop.
   *
   * @ignore
   */
  protected readonly inflight: Set<IoCResolveFrame>;

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
   * Child scopes that own something to clean up (instances, modules, or scopes of their own) and
   * aren't disposed yet; disposing this container disposes them. Scopes that own nothing aren't
   * tracked, so dropping them costs nothing.
   *
   * @ignore
   */
  protected readonly children: Set<IoCContainer>;

  /**
   * Whether this scope is in its parent's `children`.
   *
   * @ignore
   */
  protected retained?: boolean;

  /**
   * Creates a container. Every option is optional: with none, the container is already strict,
   * lazy and protected against hangs.
   *
   * @param options Levels, timeouts, events and test mode.
   */
  constructor(options?: IoCContainerOptions) {
    const levels = options?.Levels;

    if (levels && (new Set(levels).size !== levels.length || levels.some((l) => !l))) {
      throw new IoCRegistrationError('Levels must be distinct, non-empty names.');
    }

    checkTimeout(options?.PendingTimeoutMs, 'PendingTimeoutMs');

    // Frozen, so nothing (a module included) can switch on testing mode or change levels later.
    this.options = Object.freeze({
      ...options,
      Levels: levels ? Object.freeze([...levels]) : undefined,
    });

    this.asyncContext = this.options.AsyncContext === false
      ? undefined
      : this.options.AsyncContext ?? runtimeAsyncContext();

    this.registrations = new Map();
    this.scopedHolders = new Map();
    this.owned = [];
    this.expected = new Map();
    this.modules = [];
    this.declarers = new Map();
    this.startedLayers = [];
    this.startMs = new Map();
    this.children = new Set();
    this.hookAborters = new Set();
    this.inflight = new Set();
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

  /**
   * Inside a factory (on the `ioc` it receives) or a module's `OnStart`, `OnStop` or `Health`, a
   * signal that aborts when the container gives up on that work: its `Start()`/`Activate()` (or
   * module) timeout expired, a failed `Start()` rolled back, or the container was disposed. Work
   * nested under it (transients, a decorator's inner build) is aborted with it. Pass it on to
   * `fetch`, database clients and long migrations so abandoned work actually stops. `undefined`
   * elsewhere, and on runtimes without `AbortController`. A `Resolve` that times out aborts only a
   * transient build; a shared singleton or scoped build keeps running for its other callers.
   *
   * @example
   * ```ts
   * import { IoCContainer, IoCToken } from '@fathym/ioc';
   *
   * const $Index = IoCToken<string[], 'Index'>('Index');
   *
   * const ioc = new IoCContainer({ PendingTimeoutMs: 20 }).RegisterFactory($Index, async (c) => {
   *   const pages: string[] = [];
   *
   *   while (!c.Signal?.aborted) {
   *     pages.push(`page ${pages.length}`); // a long crawl that never finishes by itself
   *     await new Promise((r) => setTimeout(r, 5));
   *   }
   *
   *   return pages;
   * });
   *
   * await ioc.Start().catch((err) => console.log(err.name)); // IoCActivationError; the crawl stops
   * ```
   */
  public get Signal(): IoCAbortSignal | undefined {
    const frame = (this as Indexable)[IOC_CONTEXT] as IoCResolveFrame | undefined;

    if (!frame || frame.inferred) return undefined;

    return frameAborter(frame)?.signal as IoCAbortSignal | undefined;
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

      this.self().checkResolved(observe(frame, key, n), key, n);

      return (await this.self().resolveTimed(reg, frame)) as IoCServiceOf<K>;
    }

    const started = now();

    const label = labelFor(checkKey(key), n);

    try {
      const reg = this.lookup(key, n, frame);

      this.self().checkResolved(observe(frame, key, n), key, n);

      const result = await this.self().resolveTimed(reg, frame);

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
  public Activate(): Promise<void> {
    return this.activateNow(false);
  }

  /**
   * Builds every startup singleton. With `failFast` (from `Start()`, which rolls back on any
   * failure), the first failure aborts the builds still running, through their `Signal`, and
   * only the failures that aren't that abort are reported.
   *
   * @ignore
   */
  protected async activateNow(failFast: boolean): Promise<void> {
    const self = this.self();

    self.assertNotDisposed();

    const failures: { label: string; error: unknown }[] = [];

    const work: Promise<void>[] = [];

    const activating: IoCRegistration[] = [];

    let first: { error: unknown } | undefined;

    for (const bank of self.registrations.values()) {
      for (const reg of bank.values()) {
        // Transients are built per resolve, scoped services belong to the scopes that use them,
        // and on-demand singletons wait for their first resolve.
        if (reg.lifetime !== 'singleton' || reg.onDemand) continue;

        activating.push(reg);

        work.push(
          Promise.resolve()
            .then(() =>
              self.timed(
                reg.resolveIn(self, undefined),
                reg.label,
                reg.holder,
                reg.timeoutMs,
                undefined,
                // Startup gave up on it: tell the factory, through its Signal.
                (err) => abortFrame(reg.holder?.building, err),
              )
            )
            .then(noop, (error) => {
              // A build that gave up because it was told to (it threw the abort reason) didn't fail.
              if (first && error === first.error) return;

              failures.push({ label: reg.label, error });

              if (!failFast || first) return;

              first = { error };

              for (const other of activating) {
                if (other !== reg && other.holder?.state === 'pending') {
                  abortFrame(other.holder.building, error);
                }
              }
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
   * - `undeclared`: a module's service depending on a service from another module, or from the
   *   application, that the module neither `Requires` nor lists in `Needs`.
   *
   * Keys declared with {@link IoCContainer.Expect} count as provided. Only declared `Deps` are
   * read, so the result never depends on what has already run: what factories without `Deps`
   * resolve is reported as they run (an `IOC_UNDECLARED_DEPENDENCY` warning), and `Activate()`
   * builds everything. Pass `{ Throw: false }` to get the issues back instead of an error.
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
                  `would keep one instance for its whole life. Give ${reg.label} a lifetime no ` +
                  `longer than ${target.label}'s, or resolve ${target.label} where it is used, ` +
                  `from the scope at hand.`,
              );
            }
          }
        };

        visit(reg, []);
      }

      // Undeclared module dependencies: a module may lean only on what it declares. Checked on
      // declared Deps only, so the result never depends on what has run; what factories resolve
      // is reported as it happens (IOC_UNDECLARED_DEPENDENCY), and enforced for encapsulated
      // modules.
      if (reg.module) {
        const module = reg.module as IoCModule;

        // An encapsulated module sees only the modules it requires directly, as at runtime.
        const direct = this.isEncapsulated(module);

        for (const dep of reg.deps ?? []) {
          // IoCAll takes every name of the key; anything else, one name.
          const name = dep.mode === 'all' ? undefined : dep.name;

          // Collecting every contribution to a key is how extension points work (a host
          // gathering its plugins' routes), so only an encapsulated module is held to it.
          if (name === undefined && !direct) continue;

          // Nothing anywhere provides it: that is `missing`, reported above (an expected key is
          // the application's to provide, per scope).
          const known = name === undefined
            ? this.namesOf(dep.key).length > 0
            : !!resolveDep(dep) || this.providersOf(dep.key, name).length > 0;

          if (!known && !this.isExpected(dep.key, dep.name)) continue;

          if (this.mayUse(module, dep.key, name, direct)) continue;

          const label = name === undefined ? labelFor(dep.key, DEFAULT_NAME) : dependencyLabel(dep);

          const from = (name === undefined ? this.namesOf(dep.key) : [dep.name])
            .flatMap((n) => this.providersOf(dep.key, n))[0];

          issue(
            'undeclared',
            reg.label,
            from
              ? `${reg.label} (module '${module.Name}') depends on ${label} from module ` +
                `'${from.Name}', but '${module.Name}' neither requires '${from.Name}'` +
                `${direct ? ' directly' : ''} nor lists ${label} in its Needs.`
              : `${reg.label} (module '${module.Name}') depends on ${label}, which the ` +
                `application provides, but '${module.Name}' doesn't list it in its Needs.`,
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
        // Only the view: never the internal arguments a factory is called with.
        : (ioc) => call(ioc),
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
   * other. In a scope, decorating a parent's registration only affects the scope. A module may
   * decorate only its own registrations and defaults; the application may decorate any. Returns a
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

    const decorate = (inner: IoCRegistration): IoCFactory => (ioc, container, frame) => {
      const value = inner.resolveIn(container, frame);

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
      // Decorating doesn't change who owns the service, or whether it is a default; the
      // decorator itself runs as whoever decorated.
      owner: { module: original.module as IoCModule | undefined, default: original.default },
      actor: this.currentModule(),
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
   * A module may remove only its own registrations and defaults; the application may remove any.
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

    recordUndo(() => {
      if (!bank.has(n)) bank.set(n, reg);
    });

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
    return this.describeNow();
  }

  /**
   * Checks that the application is ready for work, for readiness and liveness probes: runs every
   * started module's `Health` hook (started scopes' modules included) concurrently, each bounded by `TimeoutMs` (its `ioc.Signal`
   * aborts when that expires). `Healthy` is true when the container has started and every check
   * passed; a check fails by throwing or returning `false`, which the report records rather than
   * throws.
   *
   * For a liveness probe, treat only `State === 'disposed'` (or a hung `Health()`) as dead: a
   * container that is still starting is alive, just not ready.
   *
   * @example
   * ```ts
   * import { IoCContainer } from '@fathym/ioc';
   *
   * let connected = true;
   *
   * const ioc = new IoCContainer().Use({
   *   Name: 'Database',
   *   Register: () => {},
   *   Health: () => connected, // or ping the server, and throw what went wrong
   * });
   *
   * await ioc.Start();
   *
   * console.log((await ioc.Health()).Healthy); // true
   *
   * connected = false;
   *
   * const report = await ioc.Health();
   *
   * console.log(report.Healthy, report.Modules); // false [{ Module: 'Database', Healthy: false, … }]
   *
   * await ioc.Dispose();
   * ```
   */
  public async Health(options?: IoCHealthOptions): Promise<IoCHealthReport> {
    const self = this.self();

    checkTimeout(options?.TimeoutMs, 'TimeoutMs');

    const timeoutMs = options?.TimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;

    if (self.state !== 'started') return { Healthy: false, State: self.state, Modules: [] };

    // This container's started modules, then those of its started scopes (late plugins).
    const checked: [IoCContainer, IoCModule][] = [];

    const collect = (container: IoCContainer) => {
      for (const module of container.startedLayers.flat()) {
        if (module.Health) checked.push([container, module]);
      }

      for (const scope of container.children) {
        if (scope.self().state === 'started') collect(scope.self());
      }
    };

    collect(self);

    const modules = await Promise.all(checked.map(async ([owner, module]) => {
      const begin = now();

      const aborter = createAborter();

      if (aborter) owner.hookAborters.add(aborter);

      let result: IoCModuleHealth;

      try {
        const value = await self.timed(
          Promise.resolve().then(() =>
            module.Health!(
              new IoCModuleView(owner, module, undefined, aborter) as unknown as IoCContainer,
            )
          ),
          `Module '${module.Name}' Health`,
          undefined,
          timeoutMs,
          HEALTH_TIMEOUT_HINT,
          (err) => aborter?.abort(err),
        );

        result = { Module: module.Name, Healthy: value !== false, Ms: now() - begin };
      } catch (err) {
        result = { Module: module.Name, Healthy: false, Ms: now() - begin, Error: err };
      } finally {
        if (aborter) owner.hookAborters.delete(aborter);
      }

      self.emit({ Type: 'health', ...result });

      return result;
    }));

    return {
      Healthy: self.state === 'started' && modules.every((m) => m.Healthy),
      State: self.state,
      Modules: modules,
    };
  }

  /**
   * Builds the `Describe()` snapshot.
   *
   * @ignore
   */
  protected describeNow(): IoCDescription {
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
            Observed: [...reg.observed ?? []].flatMap(([k, names]) =>
              [...names].map((n) => labelFor(k, n))
            ),
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

      checkTimeout(module.TimeoutMs, 'TimeoutMs');

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

      module.Register(new IoCModuleView(self, module) as unknown as IoCContainer);

      self.modules.push(module);

      self.retain();

      recordUndo(() => self.modules.splice(self.modules.indexOf(module), 1));
    };

    // All or nothing: if a Register throws, every registration this call made is undone.
    atomically(() => {
      for (const module of modules as readonly IoCModule[]) visit(module, []);
    });

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
  protected timed(
    value: unknown,
    label: string,
    holder?: IoCHolder,
    timeoutMs?: number,
    hint?: string,
    onTimeout?: (error: unknown) => void,
  ): unknown {
    const ms = timeoutMs ?? this.self().options.PendingTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!ms || !(value instanceof Promise)) return value;

    let timer: unknown;

    const advice = hint ??
      (timeoutMs !== undefined
        ? `Something it awaits may never settle; raise its TimeoutMs if it is just slow.`
        : undefined);

    const timeout = new Promise<never>((_, reject) => {
      timer = host.setTimeout(() => {
        const error = new IoCResolveTimeoutError(label, ms, pendingLabels(holder), advice);

        onTimeout?.(error);

        reject(error);
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
      this.checkParentModulesStarted();

      if (options?.Validate !== false) this.Validate();

      await this.activateNow(true);

      for (const layer of this.layers()) {
        if (this.disposing) throw new IoCContainerDisposedError();

        const failures: { Module: string; Error: unknown }[] = [];

        const started: IoCModule[] = [];

        // One module failing fails the layer: its siblings are told to give up through their
        // Signal, so the rollback doesn't wait for work that won't be used.
        const siblings: IoCAborter[] = [];

        await Promise.all(layer.map(async (module) => {
          const begin = now();

          const aborter = createAborter();

          if (aborter) {
            this.hookAborters.add(aborter);

            siblings.push(aborter);
          }

          try {
            await this.timed(
              module.OnStart?.(
                new IoCModuleView(this, module, undefined, aborter) as unknown as IoCContainer,
              ),
              `Module '${module.Name}' OnStart`,
              undefined,
              module.TimeoutMs,
              MODULE_TIMEOUT_HINT,
              (err) => aborter?.abort(err),
            );

            const ms = now() - begin;

            this.startMs.set(module, ms);

            started.push(module);

            this.emit({ Type: 'start', Module: module.Name, Ms: ms });
          } catch (err) {
            failures.push({ Module: module.Name, Error: err });

            for (const sibling of siblings) if (sibling !== aborter) sibling.abort(err);

            this.emit({ Type: 'start', Module: module.Name, Ms: now() - begin, Error: err });
          } finally {
            if (aborter) this.hookAborters.delete(aborter);
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
      // Dispose() is running: it stops and disposes everything; nothing to roll back here. A real
      // failure is still reported as itself.
      if (this.disposing) {
        if (err instanceof LayerFailure) {
          const [first] = err.failures;

          throw new IoCStartError(first.Module, first.Error, [], err.failures);
        }

        throw err;
      }

      const rollback = [
        ...await this.stopModules(),
        ...await this.forgetSince(mark, err instanceof LayerFailure ? err.failures[0].Error : err),
      ];

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
   * Throws an `IoCStartError` when a module here requires a module that belongs to a parent
   * container that hasn't started: the scope's module would start before what it needs.
   *
   * @ignore
   */
  protected checkParentModulesStarted(): void {
    for (const module of this.modules) {
      for (const required of module.Requires ?? []) {
        if (this.modules.includes(required)) continue;

        for (let c = this.parent; c; c = c.parent) {
          if (!c.modules.includes(required)) continue;

          if (c.state !== 'started') {
            throw new IoCStartError(
              module.Name,
              new Error(
                `it requires module '${required.Name}', which belongs to a parent container ` +
                  `that hasn't started; start the parent first`,
              ),
            );
          }

          break;
        }
      }
    }
  }

  /**
   * Disposes the instances created since `mark` and empties the holders built during `Start()`,
   * so a retried `Start()` builds them again.
   *
   * @ignore
   */
  protected async forgetSince(mark: number, reason?: unknown): Promise<unknown[]> {
    const errors: unknown[] = [];

    for (const entry of this.owned.splice(mark).reverse()) {
      try {
        await this.timed(
          disposeOne(entry.value),
          `Disposing ${entry.label}`,
          undefined,
          undefined,
          DISPOSE_TIMEOUT_HINT,
        );
      } catch (err) {
        errors.push(err);
      }
    }

    for (const holder of this.startBuilds ?? []) {
      // A build still running (it timed out) is abandoned: if it lands later, its instance is
      // disposed instead of cached (see `track`).
      if (holder.state === 'pending') {
        abortFrame(holder.building, reason);
        holder.promise = undefined;
        releaseBuild(holder);
      } else if (holder.state !== 'ready') continue;

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

        const aborter = createAborter();

        try {
          await this.timed(
            module.OnStop?.(
              new IoCModuleView(this, module, undefined, aborter) as unknown as IoCContainer,
            ),
            `Module '${module.Name}' OnStop`,
            undefined,
            module.TimeoutMs,
            MODULE_TIMEOUT_HINT,
            (err) => aborter?.abort(err),
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
   * Stops the modules of the live child scopes (deepest first, scopes side by side), then this
   * container's own. Nothing is disposed.
   *
   * @ignore
   */
  protected async stopTree(): Promise<unknown[]> {
    const scopes = [...this.children];

    const nested = await Promise.all(
      scopes.map(async (scope) => {
        // A scope still starting finishes its running step first (see disposeNow).
        await scope.starting?.catch(noop);

        return await scope.stopTree();
      }),
    );

    return [...nested.flat(), ...await this.stopModules()];
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
   * Tells everything still running in this container and its live scopes (builds, transients,
   * `OnStart` and `Health` calls) to stop, through their `Signal`: it is being disposed.
   *
   * @ignore
   */
  protected abortPending(reason: unknown): void {
    for (const aborter of this.hookAborters) aborter.abort(reason);

    for (const frame of this.inflight) abortFrame(frame, reason);

    for (const scope of this.children) scope.self().abortPending(reason);
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
    // no module is left half-started. Running OnStarts and builds are told to give up through
    // their Signal.
    const disposedError = new IoCContainerDisposedError();

    self.abortPending(disposedError);

    await self.starting?.catch(noop);

    // Modules stop while their services are still alive: the modules of live child scopes (which
    // may require this container's modules) first, deepest first, then this container's.
    const errors: unknown[] = await self.stopTree();

    // Then the scopes created from this container, each disposing its own scopes first.
    const results = await Promise.allSettled([...self.children].map((scope) => scope.Dispose()));

    for (const result of results) {
      if (result.status === 'rejected') errors.push(result.reason);
    }

    self.disposed = true;

    self.state = 'disposed';

    // Builds started since (by OnStop, say) won't be used either.
    self.abortPending(disposedError);

    for (const { value, label } of self.owned.splice(0).reverse()) {
      try {
        await self.timed(
          disposeOne(value),
          `Disposing ${label}`,
          undefined,
          undefined,
          DISPOSE_TIMEOUT_HINT,
        );
      } catch (err) {
        errors.push(err);
      }
    }

    if (self.retained) self.parent?.children.delete(self);

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

    // A captured container used after an `await` (or a callback a factory started): the async
    // context still knows the chain, but only as a presumption, so it is marked as one.
    const stored = this.self().asyncContext?.getStore() as IoCResolveFrame | undefined;

    if (!stored || stored.settled || typeof stored.label !== 'string') return undefined;

    return { key: {}, label: '(async)', parent: stored, settled: false, inferred: true };
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
   * The module the current registration call is made for (a module view forwarding a call), if
   * any; otherwise the application is calling.
   *
   * @ignore
   */
  protected currentModule(): IoCModule | undefined {
    return activeModule() as IoCModule | undefined;
  }

  /**
   * The modules that registered `key` + `name` here or in a parent (see `declarers`), and the
   * modules of the registrations in place.
   *
   * @ignore
   */
  protected providersOf(key: IoCKey, name: string): IoCModule[] {
    const modules = new Set<IoCModule>();

    for (const container of this.chain()) {
      const reg = container.registrations.get(key)?.get(name);

      if (reg?.module) modules.add(reg.module as IoCModule);

      for (const module of container.declarers.get(key)?.get(name) ?? []) modules.add(module);
    }

    return [...modules];
  }

  /**
   * Every name `key` is registered (or was declared by a module) under, here or in a parent.
   *
   * @ignore
   */
  protected namesOf(key: IoCKey): string[] {
    const names = new Set<string>();

    for (const container of this.chain()) {
      for (const name of container.registrations.get(key)?.keys() ?? []) names.add(name);
      for (const name of container.declarers.get(key)?.keys() ?? []) names.add(name);
    }

    return [...names];
  }

  /**
   * True when `module` may lean on `key` (every name of it, when `name` is `undefined`): it lists
   * it in `Needs` (a bare key covers every name; `[key, name]` that name), or it, or a module it
   * requires (directly, when `direct`), registers it.
   *
   * @ignore
   */
  protected mayUse(
    module: IoCModule,
    key: IoCKey,
    name: string | undefined,
    direct: boolean,
  ): boolean {
    if (needsCover(module, key, name)) return true;

    const provides = (n: string) =>
      this.providersOf(key, n).some((owner) =>
        owner === module ||
        (direct ? (module.Requires ?? []).includes(owner) : requiresModule(module, owner))
      );

    if (name !== undefined) return provides(name);

    const names = this.namesOf(key);

    return names.length > 0 && names.every(provides);
  }

  /**
   * Resolves `reg` within its timeout. A shared build (a singleton or scoped instance) keeps
   * running when one caller gives up, since others may be waiting for it; a transient build
   * serves only this caller, so it is told to stop, through its `Signal`.
   *
   * @ignore
   */
  protected resolveTimed(reg: IoCRegistration, frame: IoCResolveFrame | undefined): unknown {
    const before = reg.holder ? undefined : new Set(this.inflight);

    const value = reg.resolveIn(this, frame);

    const mine = before && [...this.inflight].filter((f) => f.reg === reg && !before.has(f));

    return this.timed(
      value,
      reg.label,
      reg.holder,
      reg.timeoutMs,
      undefined,
      mine?.length ? (err) => mine.forEach((f) => abortFrame(f, err)) : undefined,
    );
  }

  /**
   * Reports, once, a module's factory resolving something its module didn't declare. Encapsulated
   * modules are stopped by their view instead; for the others this is the runtime half of
   * `Validate()`'s `undeclared` check, which reads only declared `Deps`.
   *
   * @ignore
   */
  protected checkResolved(reg: IoCRegistration | undefined, key: IoCKey, name: string): void {
    const module = reg?.actor as IoCModule | undefined;

    if (!reg || !module || !this.options.OnEvent || this.isEncapsulated(module)) return;

    if (this.mayUse(module, key, name, false)) return;

    const label = labelFor(key, name);

    const from = this.providersOf(key, name)[0];

    this.emit({
      Type: 'warning',
      Code: 'IOC_UNDECLARED_DEPENDENCY',
      Message: from
        ? `${reg.label} (module '${module.Name}') resolved ${label} from module '${from.Name}', ` +
          `but '${module.Name}' neither requires '${from.Name}' nor lists ${label} in its Needs.`
        : `${reg.label} (module '${module.Name}') resolved ${label}, which the application ` +
          `provides, but '${module.Name}' doesn't list it in its Needs.`,
      Service: reg.label,
    });
  }

  /**
   * Whether `module` may resolve only what it declares (its own `Encapsulated`, else the
   * `EncapsulateModules` option).
   *
   * @ignore
   */
  protected isEncapsulated(module: IoCModule): boolean {
    const option = this.self().options.EncapsulateModules;

    return module.Encapsulated ?? (typeof option === 'function' ? option(module) : !!option);
  }

  /**
   * Throws `IoCSealedError` when the caller may not change `reg`. The application may change
   * anything (a module's registration emits an `IOC_MODULE_OVERRIDDEN` warning). A module may
   * change its own registrations and defaults (a default another module or the app registered
   * emits an `IOC_DEFAULT_REPLACED` warning), never another module's or the application's.
   * Testing mode lifts every rule.
   *
   * @ignore
   */
  protected checkSealed(
    reg: IoCRegistration,
    action: 'replace' | 'decorate' | 'unregister',
    report = true,
  ): void {
    if (this.self().options.Testing) return;

    const caller = this.currentModule();

    if (reg.module === caller) return;

    // The application replacing a default is the extension point working as designed.
    if (!caller && reg.default) return;

    if (!caller) {
      if (!report) return;

      this.emit({
        Type: 'warning',
        Code: 'IOC_MODULE_OVERRIDDEN',
        Message: `The application ${pastTense(action)} ${reg.label}, registered by module ` +
          `'${reg.module!.Name}'.`,
        Service: reg.label,
      });

      return;
    }

    if (reg.default) {
      if (!report) return;

      // Reported once the module's Use() succeeded; a rolled-back one changed nothing.
      afterCommit(() =>
        this.emit({
          Type: 'warning',
          Code: 'IOC_DEFAULT_REPLACED',
          Message: `Module '${caller.Name}' ${pastTense(action)} the default ${reg.label}` +
            (reg.module ? `, registered by module '${reg.module.Name}'.` : '.'),
          Service: reg.label,
        })
      );

      return;
    }

    throw new IoCSealedError(reg.label, reg.module?.Name, action);
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
  protected trackOwned(value: unknown, holder?: IoCHolder, label = 'an instance'): void {
    if (!isDisposable(value) || IOC_OWNERS.has(value)) return;

    const self = this.self();

    IOC_OWNERS.set(value, self);

    if (!self.disposed) {
      self.owned.push({ value, holder, label });

      self.retain();

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
   * Puts this scope (and its ancestors' scopes) in its parent's `children`, once it owns
   * something that disposing the parent must clean up.
   *
   * @ignore
   */
  protected retain(): void {
    const self = this.self();

    if (self.retained || !self.parent || self.disposed) return;

    self.retained = true;

    self.parent.children.add(self);

    self.parent.retain();
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

    const previous = bank.get(reg.name);

    bank.set(reg.name, reg);

    const target = bank;

    recordUndo(() => {
      if (target.get(reg.name) !== reg) return;

      if (previous) target.set(reg.name, previous);
      else target.delete(reg.name);
    });
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
    factory: IoCFactory;
    deps?: readonly IoCDependencyRecord[];
    dispose?: (instance: unknown) => unknown;
    options: IoCServiceOptions;
    /** A value registration: the value, already "built". */
    value?: { value: unknown };
    /** Set by `Decorate`, which checks sealing itself. */
    sealChecked?: boolean;
    /** Set by `Decorate`: the owner and default flag to keep (the original's). */
    owner?: { module?: IoCModule; default?: boolean };
    /** The module the factory runs as (its view); defaults to the owner. */
    actor?: IoCModule;
    /** Overrides the lifetime from the options (`Decorate` keeps the original's). */
    lifetime?: IoCLifetime;
    /** Overrides the level from the options. */
    scopeLevel?: string;
    /** Makes the factory for an isolated copy owned by `owner` (default: the same factory). */
    fork?: (owner: IoCContainer) => IoCFactory;
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

    if (options.OnDemand && lifetime !== 'singleton') {
      throw new IoCRegistrationError(
        `${label} is ${lifetime}, so it is never built at startup; OnDemand applies to singletons.`,
      );
    }

    if (scopeLevel !== undefined && !spec.detached) self.checkLevel(scopeLevel, false);

    checkTimeout(options.TimeoutMs, 'TimeoutMs');

    const declarer = spec.owner ? undefined : this.currentModule();

    /** Records the registering module as a provider of the key, once the registration succeeds. */
    const declare = () => {
      if (!declarer || spec.detached) return;

      let names = self.declarers.get(key);

      if (!names) self.declarers.set(key, names = new Map());

      let modules = names.get(name);

      if (!modules) names.set(name, modules = new Set());

      if (modules.has(declarer)) return;

      modules.add(declarer);

      const added = modules;

      recordUndo(() => added.delete(declarer));
    };

    const existing = self.registrations.get(key)?.get(name);

    if (existing && !spec.detached) {
      if (options.Default) {
        // A default yields to whatever is already registered, unless that is a default too.
        if (!existing.default) {
          declare();

          return existing;
        }

        this.checkSealed(existing, 'replace');
      } else if (!spec.sealChecked) {
        const duplicate = !options.Replace && !existing.default;

        // Sealing first (its error says more), but warn only about a change that happens.
        this.checkSealed(existing, 'replace', !duplicate);

        if (duplicate) throw new IoCDuplicateRegistrationError(label);
      }
    }

    // A default also yields to a registration in a parent (a framework default in a plugin scope).
    if (options.Default && !existing && !spec.detached) {
      const inherited = self.parent?.find(key, name);

      if (inherited && !inherited.default) {
        declare();

        return inherited;
      }
    }

    const holder: IoCHolder | undefined = lifetime === 'transient' ? undefined : { state: 'empty' };

    const owns = spec.kind !== 'value' || !!spec.dispose;

    const { dispose } = spec;

    const module = spec.owner ? spec.owner.module : this.currentModule();

    // Whose code the factory is: its view, and the module its resolves are checked against. A
    // decorator runs as whoever decorated, while the registration keeps the original's owner.
    const actor = 'actor' in spec ? spec.actor : module;

    /** Hands an instance to its owner: the `Dispose` option's cleanup, else the instance itself. */
    const own = (tracker: IoCContainer, value: unknown, h?: IoCHolder) => {
      if (!dispose) return tracker.trackOwned(value, h, label);

      const isObject = (typeof value === 'object' || typeof value === 'function') && value !== null;

      // An instance someone else already owns is theirs to clean up.
      if (isObject && IOC_OWNERS.has(value)) return;

      if (isObject) IOC_OWNERS.set(value, tracker.self());

      tracker.trackOwned({ [Symbol.asyncDispose]: async () => await dispose(value) }, h, label);
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
      const frame: IoCResolveFrame = {
        key: frameKey,
        label,
        parent,
        settled: false,
        reg,
        // A registered singleton or scoped build may serve other callers too, so it isn't
        // cancelled with the build that asked for it; transients and a decorator's inner build
        // are (see `frameAborter`).
        shared: isHolder(frameKey) && self.registrations.get(key)?.get(name) === reg,
      };

      container.inflight.add(frame);

      if (isHolder(frameKey)) frameKey.building = frame;

      let result: unknown;

      const begin = now();

      const done = (error?: { error: unknown }) => {
        frame.settled = true;

        container.inflight.delete(frame);

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
        // A module's factories act as the module (a module view); the app's get a plain view.
        const arg = actor
          ? new IoCModuleView(container, actor, frame) as unknown as IoCContainer
          : createView(container, frame) as IoCContainer;

        const context = container.asyncContext;

        result = context
          ? context.run(frame, () => withFrame(frame, () => factory(arg, container, frame)))
          : withFrame(frame, () => factory(arg, container, frame));
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
        // A synchronous factory re-entering itself, or a chain waiting on its own result. A chain
        // recovered from the async context is only presumed: this may be a callback the build
        // started rather than code it awaits, so it waits instead (a real cycle there fails at
        // PendingTimeoutMs, listing what is pending).
        if (!h.promise || (isOnActivePath(frame, h) && !crossesInferred(frame, h))) {
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
        result.then((value) => {
          if (h.state === 'ready' && h.value === value) return own(tracker, value, h);

          // The build was abandoned (a failed Start() forgot it) and landed late: nobody will use
          // this instance, so it is disposed rather than leaked.
          if (isDisposable(value) && !IOC_OWNERS.has(value)) {
            disposeOne(value).catch((err) =>
              tracker.emit({
                Type: 'warning',
                Code: 'IOC_LATE_DISPOSE_FAILED',
                Message: `${label}, built after a failed Start() gave up on it, failed to ` +
                  `dispose: ${err}`,
                Service: label,
              })
            );
          }
        }, noop);
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
      actor,
      holder,
      label,
      deps: spec.deps,
      default: (spec.owner ? spec.owner.default : options.Default) || undefined,
      onDemand: options.OnDemand || undefined,
      timeoutMs: options.TimeoutMs,
      scopeLevel,
      observed: new Map(),
      fork(owner: object): IoCRegistration {
        const target = owner as IoCContainer;

        return target.addRegistration({
          ...spec,
          // The copy keeps the original's owner and actor, whoever isolates it.
          owner: spec.owner ?? { module, default: undefined },
          actor,
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
          if (isOnActivePath(frame, reg) && !crossesInferred(frame, reg)) {
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

    if (!spec.detached) {
      self.store(reg);

      declare();
    }

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

/**
 * True when `module`'s `Needs` cover `key` + `name`: a bare key covers every name, `[key, name]`
 * only that name. `name` `undefined` (every name of the key) needs a bare key.
 */
function needsCover(module: IoCModule, key: IoCKey, name: string | undefined): boolean {
  return (module.Needs ?? []).some((need) => {
    if (!Array.isArray(need)) return need === key;

    return name !== undefined && need[0] === key && ((need[1] as string) || DEFAULT_NAME) === name;
  });
}

/** `replace` -> `replaced`, for warning messages. */
function pastTense(action: 'replace' | 'decorate' | 'unregister'): string {
  return action === 'unregister' ? 'unregistered' : `${action}d`;
}

/** The error a module view throws for a method only the application may call. */
function notForModules(module: IoCModule, method: string): IoCRegistrationError {
  return new IoCRegistrationError(
    `Module '${module.Name}' called ${method}(), which only the application can call. ` +
      (method === 'Use'
        ? `List the modules a module needs in its Requires instead.`
        : method === 'Expect'
        ? `Declare the keys a module needs from elsewhere in its Needs instead.`
        : `Modules receive a view of the container for registering and resolving.`),
  );
}

/**
 * What a module's `Register`, `OnStart`, `OnStop` and factories receive instead of the container:
 * a closed view that registers as the module and resolves normally. It holds the container in a
 * private field and has no prototype link to it, so module code can't reach the container (or
 * forge another module's identity) through it. Methods only the application may call throw.
 */
class IoCModuleView {
  readonly #container: IoCContainer;

  readonly #module: IoCModule;

  readonly #frame?: IoCResolveFrame;

  readonly #encapsulated: boolean;

  readonly #aborter?: IoCAborter;

  constructor(
    container: IoCContainer,
    module: IoCModule,
    frame?: IoCResolveFrame,
    aborter?: IoCAborter,
  ) {
    this.#container = container;
    this.#module = module;
    this.#frame = frame;
    this.#aborter = aborter;

    this.#encapsulated = (container as Indexable).isEncapsulated(module);
  }

  /**
   * Throws `IoCAccessError` when this module is encapsulated and hasn't declared `key` + `name`
   * (every name of the key, when `name` is `undefined`).
   */
  #check(key: unknown, name: string | undefined): void {
    if (!this.#encapsulated) return;

    const k = checkKey(key);

    const module = this.#module;

    if ((this.#container as Indexable).mayUse(module, k, name, true)) return;

    throw new IoCAccessError(
      module.Name,
      name === undefined ? `${keyDescription(k)} (every name)` : labelFor(k, name),
    );
  }

  /** Throws `IoCAccessError` for a whole-container call when this module is encapsulated. */
  #checkWhole(method: string): void {
    if (this.#encapsulated) throw new IoCAccessError(this.#module.Name, `${method}()`);
  }

  get State(): IoCContainerState {
    return this.#container.State;
  }

  get Signal(): IoCAbortSignal | undefined {
    if (this.#aborter) return this.#aborter.signal as IoCAbortSignal;

    if (!this.#frame || this.#frame.inferred) return undefined;

    return frameAborter(this.#frame)?.signal as IoCAbortSignal | undefined;
  }

  /** Where resolves continue from: the factory's resolution chain, when this is a factory's. */
  #resolver(): IoCContainer {
    return this.#frame ? createView(this.#container, this.#frame) : this.#container;
  }

  /** Runs a registration call as the module. */
  #as<T>(fn: (c: IoCContainer) => T): T {
    return asModule(this.#module, () => fn(this.#container));
  }

  RegisterClass(...args: Parameters<IoCContainer['RegisterClass']>): this {
    this.#as((c) => c.RegisterClass(...args));
    return this;
  }

  RegisterFactory(...args: Parameters<IoCContainer['RegisterFactory']>): this {
    this.#as((c) => c.RegisterFactory(...args));
    return this;
  }

  RegisterValue(...args: Parameters<IoCContainer['RegisterValue']>): this {
    this.#as((c) => c.RegisterValue(...args));
    return this;
  }

  Decorate(...args: Parameters<IoCContainer['Decorate']>): () => void {
    // Decorating hands the decorator the service: only for what the module may resolve.
    this.#check(args[0], args[2]?.Name || DEFAULT_NAME);

    const restore = this.#as((c) => c.Decorate(...args));

    return () => this.#as(() => restore());
  }

  Unregister(...args: Parameters<IoCContainer['Unregister']>): boolean {
    return this.#as((c) => c.Unregister(...args));
  }

  Isolate(...args: Parameters<IoCContainer['Isolate']>): this {
    for (const item of args) {
      const { key, name } = normalizeDependency(item);

      this.#check(key, name);
    }

    this.#as((c) => c.Isolate(...args));
    return this;
  }

  Resolve(...args: Parameters<IoCContainer['Resolve']>): ReturnType<IoCContainer['Resolve']> {
    try {
      this.#check(args[0], args[1] || DEFAULT_NAME);
    } catch (err) {
      return Promise.reject(err);
    }

    return this.#resolver().Resolve(...args);
  }

  TryResolve(
    ...args: Parameters<IoCContainer['TryResolve']>
  ): ReturnType<IoCContainer['TryResolve']> {
    try {
      this.#check(args[0], args[1] || DEFAULT_NAME);
    } catch (err) {
      return Promise.reject(err);
    }

    return this.#resolver().TryResolve(...args);
  }

  ResolveAll(
    ...args: Parameters<IoCContainer['ResolveAll']>
  ): ReturnType<IoCContainer['ResolveAll']> {
    try {
      this.#check(args[0], undefined);
    } catch (err) {
      return Promise.reject(err);
    }

    return this.#resolver().ResolveAll(...args);
  }

  ResolveNamed(
    ...args: Parameters<IoCContainer['ResolveNamed']>
  ): ReturnType<IoCContainer['ResolveNamed']> {
    try {
      this.#check(args[0], undefined);
    } catch (err) {
      return Promise.reject(err);
    }

    return this.#resolver().ResolveNamed(...args);
  }

  ResolveRecord(
    ...args: Parameters<IoCContainer['ResolveRecord']>
  ): ReturnType<IoCContainer['ResolveRecord']> {
    try {
      for (const dep of Object.values(args[0])) {
        const { key, name, mode } = normalizeDependency(dep);

        this.#check(key, mode === 'all' ? undefined : name);
      }
    } catch (err) {
      return Promise.reject(err);
    }

    // Each entry resolves through this view, so lazy entries are checked when they run too.
    return (this.#container.ResolveRecord as (r: unknown) => ReturnType<
      IoCContainer['ResolveRecord']
    >).call(this, ...args);
  }

  Names(...args: Parameters<IoCContainer['Names']>): string[] {
    this.#check(args[0], undefined);

    return this.#container.Names(...args);
  }

  Has(...args: Parameters<IoCContainer['Has']>): boolean {
    this.#check(args[0], args[1] || DEFAULT_NAME);

    return this.#container.Has(...args);
  }

  Describe(): IoCDescription {
    this.#checkWhole('Describe');

    return this.#container.Describe();
  }

  Validate(...args: Parameters<IoCContainer['Validate']>): IoCValidationIssue[] {
    this.#checkWhole('Validate');

    return this.#container.Validate(...args);
  }

  Typed(): this {
    return this;
  }

  /** A scope of the container, seen through a view that still acts as this module. */
  CreateScope(...args: Parameters<IoCContainer['CreateScope']>): IoCModuleView {
    return new IoCModuleView(this.#container.CreateScope(...args), this.#module);
  }

  Use(): never {
    throw notForModules(this.#module, 'Use');
  }

  Start(): Promise<never> {
    return Promise.reject(notForModules(this.#module, 'Start'));
  }

  Activate(): Promise<never> {
    return Promise.reject(notForModules(this.#module, 'Activate'));
  }

  Dispose(): Promise<never> {
    return Promise.reject(notForModules(this.#module, 'Dispose'));
  }

  Health(): Promise<never> {
    return Promise.reject(notForModules(this.#module, 'Health'));
  }

  [Symbol.asyncDispose](): Promise<never> {
    return Promise.reject(notForModules(this.#module, 'Dispose'));
  }

  Override(): never {
    throw notForModules(this.#module, 'Override');
  }

  Expect(): never {
    throw notForModules(this.#module, 'Expect');
  }
}
