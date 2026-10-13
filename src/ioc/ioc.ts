import {
  IoCCircularDependencyError,
  IoCContainerDisposedError,
  IoCServiceNotFoundError,
  IoCValidationError,
} from './errors.ts';
import {
  type AnyFunction,
  createLegacyThunk,
  createThunk,
  createView,
  currentFrame,
  framePath,
  IOC_CONTEXT,
  IOC_PROTOCOL,
  IOC_PROTOCOL_VERSION,
  IOC_SELF,
  type IoCDependencyRecord,
  type IoCHolder,
  type IoCLifetime,
  type IoCRegistration,
  type IoCResolveFrame,
  isClassLike,
  isOnActivePath,
  labelFor,
  noop,
  registrationOf,
  settleInto,
  withFrame,
} from './internals.ts';
import type { IoCToken } from './IoCToken.ts';

/** Any constructed service value. */
// deno-lint-ignore ban-types
export type IoCServiceConstructed = { constructor: Function };

/** A class that can be registered and used as a resolution key. */
// deno-lint-ignore no-explicit-any
export type IoCServiceConstructor<T> = { new (...args: any[]): T };

/**
 * A class used only as a key (it is never constructed by the container), so abstract classes
 * work as typed "interface" keys: `ioc.Register(Repo, () => new PgRepo())`.
 */
// deno-lint-ignore no-explicit-any
export type IoCServiceKeyConstructor<T> = abstract new (...args: any[]) => T;

/** Anything a service can be resolved by: a typed token / symbol, or a class. */
export type IoCServiceKey<T> = IoCToken<T> | IoCServiceKeyConstructor<T>;

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
};

/** A dependency key: a typed token / symbol, or a class (abstract classes included). */
export type IoCDependencyKey<T> = IoCToken<T> | IoCServiceKeyConstructor<T>;

/** A declared dependency: a key, or `[key, name]` for a named registration. */
export type IoCDependency<T> = IoCDependencyKey<T> | readonly [IoCDependencyKey<T>, string];

/** One dependency per constructor parameter, each typed to match its parameter. */
export type IoCDependenciesFor<P extends readonly unknown[]> = {
  readonly [K in keyof P]: IoCDependency<P[K]>;
};

/** Options accepted by {@link IoCContainer.RegisterClass}. */
export type IoCRegisterClassOptions<C extends IoCServiceConstructor<unknown>> =
  & IoCServiceOptions
  & {
    /**
     * The services to pass to the constructor, in parameter order, checked against the
     * constructor's parameter types. The container resolves them (in the resolving scope) and
     * calls `new clazz(...deps)`. Declared dependencies are also checked by `Validate()`.
     */
    Deps?: IoCDependenciesFor<ConstructorParameters<C>>;
  };

/** Options for registrations whose key is given separately (no `Type`). */
export type IoCRegisterOptions = Omit<IoCServiceOptions, 'Type'>;

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

function keySymbol(key: AnyFunction | symbol): symbol {
  return typeof key === 'symbol' ? key : Symbol.for(key.name);
}

function normalizeDependency(dep: unknown): IoCDependencyRecord {
  if (Array.isArray(dep)) {
    return { key: dep[0] as AnyFunction | symbol, name: (dep[1] as string) || DEFAULT_NAME };
  }

  return { key: dep as AnyFunction | symbol, name: DEFAULT_NAME };
}

function dependencyLabel(dep: IoCDependencyRecord): string {
  return labelFor(keySymbol(dep.key), dep.name);
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
 */
export class IoCContainer {
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

  /** @ignore */
  protected disposed: boolean;

  constructor() {
    this.services = new Map<symbol, Map<string, IoCServiceResolutions>>();

    this.symbols = new Map<string, symbol>();

    this.byCtor = new Map();

    this.scopedHolders = new Map();

    this.owned = [];

    this.disposed = false;

    Object.defineProperty(this, IOC_PROTOCOL, { value: IOC_PROTOCOL_VERSION });
  }

  //#region Resolution

  /** Resolves a service by typed token (or symbol), optionally by name. */
  public async Resolve<T>(token: IoCToken<T>, name?: string): Promise<T>;

  /** Resolves a service by class (abstract classes work as keys), optionally by name. */
  public async Resolve<T>(ctor: IoCServiceKeyConstructor<T>, name?: string): Promise<T>;

  public async Resolve<T>(
    ctorSymbol: IoCServiceKeyConstructor<T> | symbol,
    name?: string,
  ): Promise<T> {
    const frame = this.frame();

    this.assertNotDisposed();

    const entry = this.lookup(ctorSymbol, name ?? DEFAULT_NAME, frame);

    return (await this.realize(entry, frame)) as T;
  }

  /** Resolves a service, or `undefined` when nothing is registered for it. */
  public async TryResolve<T>(
    key: IoCServiceKey<T> | symbol,
    name?: string,
  ): Promise<T | undefined> {
    const frame = this.frame();

    this.assertNotDisposed();

    const found = this.find(key, name ?? DEFAULT_NAME);

    return found ? (await this.realize(found.entry, frame)) as T : undefined;
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
   * ioc.Register(IoCToken('Cache'), () => new Map(), { Lazy: true });
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
      throw new AggregateError(
        failures.map((f) => f.error),
        `IoC activation failed for: ${failures.map((f) => f.label).join(', ')}.`,
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
   * Factories are opaque, so dependencies resolved inside them are not checked; `Activate()`
   * covers those by building everything.
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
  public Validate(): void {
    const problems: string[] = [];

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
      if (reg.kind === 'class' && !reg.deps && reg.ctor && reg.ctor.length > 0) {
        problems.push(
          `${reg.label} is constructed without arguments, but its constructor declares ` +
            `${reg.ctor.length} parameter(s); register it with a factory or with Deps.`,
        );
      }

      for (const dep of reg.deps ?? []) {
        if (!this.find(dep.key, dep.name)) {
          problems.push(
            `${reg.label} depends on ${dependencyLabel(dep)}, which is not registered.`,
          );
          continue;
        }

        const depReg = resolveDep(dep);

        if (reg.lifetime === 'singleton' && depReg?.lifetime === 'scoped') {
          problems.push(
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
          problems.push(`Circular dependency: ${cycle.join(' -> ')}.`);
        }

        return;
      }

      state.set(reg, 'visiting');

      for (const dep of reg.deps ?? []) {
        const depReg = resolveDep(dep);

        if (depReg) visit(depReg, [...path, reg]);
      }

      state.set(reg, 'done');
    };

    for (const reg of registrations) visit(reg, []);

    if (problems.length) throw new IoCValidationError(problems);
  }

  //#endregion

  //#region Registration

  // Overload order matters for typing the factory parameter (`(ioc) => …`): the key + factory
  // forms come first, and the class-only and factory-only forms share one union signature,
  // because TypeScript does not contextually type a callback across separate overloads.

  /**
   * Registers a scoped factory under a token or symbol; returns a function that removes the
   * registration.
   */
  public Register<T>(
    type: IoCToken<T>,
    instance: IoCServiceResolver<NoInfer<T>>,
    options: IoCRegisterOptions & { Lifetime: 'scoped' },
  ): () => void;

  /** Registers a factory under a token or symbol (same as passing `{ Type: type }`). */
  public Register<T>(
    type: IoCToken<T>,
    instance: IoCServiceResolver<NoInfer<T>>,
    options?: IoCRegisterOptions,
  ): void | (() => void);

  /**
   * Registers `clazz` as a scoped service created by `instance`; returns a function that removes
   * the registration.
   */
  public Register<T>(
    clazz: IoCServiceKeyConstructor<T>,
    instance: IoCServiceResolver<T>,
    options: IoCServiceOptions & { Lifetime: 'scoped' },
  ): () => void;

  /** Registers a factory keyed by `clazz` (or `options.Type`). */
  public Register<T>(
    clazz: IoCServiceKeyConstructor<T>,
    instance: IoCServiceResolver<T>,
    options?: IoCServiceOptions,
  ): void | (() => void);

  /**
   * Registers a scoped class, or a scoped factory (`options.Type` is required for factories);
   * returns a function that removes the registration.
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
        throw new Error(`A factory is required when registering by symbol.`);
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
      throw new Error(`The Type was missing for the registration.`);
    }

    const lifetime = opts.Lifetime ?? 'singleton';

    const unregister = this.addRegistration({
      symbol: opts.Type,
      name: opts.Name || DEFAULT_NAME,
      lifetime,
      kind,
      ctor: clazz && opts.Type === Symbol.for(clazz.name) ? clazz : undefined,
      factory,
      lazy: !!opts.Lazy,
    });

    // Historically only scoped registrations return their disposer.
    return lifetime === 'scoped' ? unregister : undefined;
  }

  /**
   * Registers a class that the container constructs (`new clazz()`), keyed by the class (or
   * `options.Type`). Returns a function that removes the registration.
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
  public RegisterClass<C extends IoCServiceConstructor<unknown>>(
    clazz: C,
    options?: IoCRegisterClassOptions<C>,
  ): () => void {
    if (!isClassLike(clazz)) {
      throw new Error(`RegisterClass expects a class.`);
    }

    const opts = { ...options };

    const type = opts.Type ?? (clazz.name ? Symbol.for(clazz.name) : undefined);

    if (!type) throw new Error(`The Type was missing for the registration.`);

    const deps = opts.Deps?.map(normalizeDependency);

    return this.addRegistration({
      symbol: type,
      name: opts.Name || DEFAULT_NAME,
      lifetime: opts.Lifetime ?? 'singleton',
      kind: 'class',
      ctor: type === Symbol.for(clazz.name) ? clazz : undefined,
      factory: deps
        ? async (ioc) =>
          new clazz(
            ...await Promise.all(deps.map((d) => ioc.Resolve(d.key as symbol, d.name))),
          )
        : () => new clazz(),
      lazy: !!opts.Lazy,
      deps,
    });
  }

  /**
   * Registers a factory under a token, symbol or class key. The factory receives the container
   * (use it rather than a captured container so scopes and cycle detection work). Returns a
   * function that removes the registration.
   */
  public RegisterFactory<T>(
    key: IoCServiceKey<T>,
    factory: IoCServiceResolver<NoInfer<T>>,
    options?: IoCRegisterOptions,
  ): () => void {
    if (typeof factory !== 'function') {
      throw new Error(`RegisterFactory expects a factory function.`);
    }

    const opts = { ...options };

    const symbol = keySymbol(key);

    return this.addRegistration({
      symbol,
      name: opts.Name || DEFAULT_NAME,
      lifetime: opts.Lifetime ?? 'singleton',
      kind: 'factory',
      ctor: typeof key === 'function' ? key : undefined,
      factory: factory as (ioc: IoCContainer) => unknown,
      lazy: !!opts.Lazy,
    });
  }

  /**
   * Registers an existing value (any value, including functions and thenables) as a singleton.
   * The container never invokes or disposes it. Returns a function that removes the
   * registration.
   */
  public RegisterValue<T>(
    key: IoCServiceKey<T>,
    value: NoInfer<T>,
    options?: { Name?: string },
  ): () => void {
    return this.addRegistration({
      symbol: keySymbol(key),
      name: options?.Name || DEFAULT_NAME,
      lifetime: 'singleton',
      kind: 'value',
      ctor: typeof key === 'function' ? key : undefined,
      factory: () => value,
      lazy: false,
    });
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
   * ioc.Register($Prices, () => ({ quote: (symbol) => symbol.length }));
   * ioc.Decorate($Prices, (inner) => {
   *   const cache = new Map<string, number>();
   *   return { quote: (s) => cache.get(s) ?? cache.set(s, inner.quote(s)).get(s)! };
   * });
   * ```
   */
  public Decorate<T>(
    key: IoCServiceKey<T>,
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

    const remove = self.addRegistration({
      symbol,
      name,
      lifetime,
      kind: 'factory',
      ctor: typeof key === 'function' ? key : originalReg?.ctor,
      factory: (ioc) => {
        const inner = ioc.realize(original, ioc.frame());

        return inner instanceof Promise
          ? inner.then((value) => decorator(value as T, ioc))
          : decorator(inner as T, ioc);
      },
      lazy: true,
      deps: originalReg?.deps,
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

    self.bank(symbol).set(name, instance);

    const reg = registrationOf(instance);

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
  public CreateScope(): IoCContainer {
    const self = this.self();

    self.assertNotDisposed();

    const scope = new IoCContainer();

    scope.parent = self;

    return scope;
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

    self.disposed = true;

    const owned = self.owned.splice(0).reverse();

    const errors: unknown[] = [];

    for (const value of owned) {
      try {
        const v = value as Indexable;

        if (typeof v[Symbol.asyncDispose] === 'function') {
          await v[Symbol.asyncDispose]();
        } else if (typeof v[Symbol.dispose] === 'function') {
          v[Symbol.dispose]();
        }
      } catch (err) {
        errors.push(err);
      }
    }

    self.scopedHolders.clear();
    self.services.clear();
    self.byCtor.clear();

    if (errors.length) {
      throw new AggregateError(errors, 'Errors occurred while disposing the IoC container.');
    }
  }

  /** Same as {@link IoCContainer.Dispose}; enables `await using`. */
  public async [Symbol.asyncDispose](): Promise<void> {
    await this.Dispose();
  }

  //#endregion

  //#region Internals

  /**
   * The resolution frame a call continues: the view's frame, else the running factory's.
   *
   * @ignore
   */
  protected frame(): IoCResolveFrame | undefined {
    return (this as Indexable)[IOC_CONTEXT] ?? currentFrame();
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

  /** @ignore */
  protected assertNotDisposed(): void {
    if (((this as Indexable)[IOC_SELF] ?? this).disposed) throw new IoCContainerDisposedError();
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
   * Records an instance this container created, for disposal.
   *
   * @ignore
   */
  protected trackOwned(value: unknown): void {
    if (isDisposable(value)) this.owned.push(value);
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

    if (found) return found.entry;

    const symbol = keySymbol(key);

    const names = new Set<string>();

    for (const container of this.chain()) {
      for (const n of container.services.get(symbol)?.keys() ?? []) names.add(n);
    }

    throw new IoCServiceNotFoundError(symbol, name, [...names], framePath(frame));
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
  }): () => void {
    const self = this.self();

    self.assertNotDisposed();

    const { symbol, name, lifetime, factory } = spec;

    const holder: IoCHolder | undefined = lifetime === 'transient' ? undefined : { state: 'empty' };

    const label = labelFor(symbol, name);

    const owns = spec.kind !== 'value';

    /**
     * Invokes the factory as one frame of a resolution chain. Factories normally receive a view
     * of `container` that carries the chain; the registration-time eager run passes the real
     * container (as before) and relies on the synchronous current frame only.
     */
    const run = (
      container: object,
      parent: IoCResolveFrame | undefined,
      key: object,
      view = true,
    ) => {
      const frame: IoCResolveFrame = { key, label, parent, settled: false };

      let result: unknown;

      try {
        const arg = (view ? createView(container, frame) : container) as IoCContainer;

        result = withFrame(frame, () => factory(arg));
      } catch (err) {
        frame.settled = true;
        throw err;
      }

      if (result instanceof Promise) {
        return result.finally(() => {
          frame.settled = true;
        });
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

        return h.promise;
      }

      h.state = 'pending';

      let result: unknown;

      try {
        result = run(buildOn, frame, h);
      } catch (err) {
        h.state = 'empty';
        throw err;
      }

      return track(h, settleInto(h, result), tracker);
    };

    const track = (h: IoCHolder, result: unknown, tracker: IoCContainer): unknown => {
      if (!owns) return result;

      if (h.state === 'ready') {
        tracker.trackOwned(result);
      } else if (result instanceof Promise) {
        result.then((value) => tracker.trackOwned(value), noop);
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
      resolveIn(container: object, frame?: IoCResolveFrame): unknown {
        if (!holder) {
          if (isOnActivePath(frame, reg)) {
            throw new IoCCircularDependencyError([...framePath(frame), label]);
          }

          return run(container, frame, reg);
        }

        if (lifetime === 'scoped') {
          const c = container as Indexable;

          const scoped: IoCHolder | undefined = typeof c.scopedHolderFor === 'function'
            ? c.scopedHolderFor(reg)
            : undefined;

          // One instance per child scope, built against (and disposed by) that scope.
          if (scoped) return fromHolder(scoped, c, c, frame);
        }

        // Singletons always build against their owner, never against whoever resolved them.
        return fromHolder(holder, self, self, frame);
      },
    };

    const thunk = createThunk(reg);

    if (holder && !spec.lazy) {
      // Eager: build now against the real container (as before). A synchronous throw propagates
      // and leaves any previous registration in place. An async rejection never becomes an
      // unhandled rejection; it resets the holder so a Resolve made after it settled retries
      // (for example once a missing dependency has been registered).
      holder.state = 'pending';

      let result: unknown;

      try {
        result = run(self, undefined, holder, false);
      } catch (err) {
        holder.state = 'empty';
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
