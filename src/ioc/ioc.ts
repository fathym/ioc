import { IoCCircularDependencyError, IoCServiceNotFoundError } from './errors.ts';
import {
  createLegacyThunk,
  createThunk,
  createView,
  framePath,
  IOC_CONTEXT,
  IOC_PROTOCOL,
  IOC_PROTOCOL_VERSION,
  IOC_SELF,
  type IoCHolder,
  type IoCLifetime,
  type IoCRegistration,
  type IoCResolveFrame,
  isClassLike,
  isOnActivePath,
  labelFor,
  registrationOf,
  settleInto,
} from './internals.ts';

/** Any constructed service value. */
// deno-lint-ignore ban-types
export type IoCServiceConstructed = { constructor: Function };

/** A class that can be registered and used as a resolution key. */
// deno-lint-ignore no-explicit-any
export type IoCServiceConstructor<T> = { new (...args: any[]): T };

/** Options accepted by {@link IoCContainer.Register}. */
export type IoCServiceOptions = {
  /**
   * Defer creating a singleton or scoped service until it is first resolved. The created
   * instance is then memoized; a failed creation is retried on the next resolve.
   */
  Lazy?: boolean;

  /**
   * `singleton` (default): one shared instance. `transient`: a new instance per resolve.
   * `scoped`: a singleton whose registration can be removed with the function `Register` returns.
   */
  Lifetime?: 'transient' | 'scoped';

  /** Registers under a name, so several services can share one type (`$default` when omitted). */
  Name?: string;

  /** The symbol to register under. Defaults to `Symbol.for(clazz.name)` for class registrations. */
  Type?: symbol;
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

const DEFAULT_NAME = '$default';

/**
 * A small, async-first, decorator-free inversion-of-control container.
 *
 * ```ts
 * const ioc = new IoCContainer();
 *
 * ioc.Register(Config, () => new Config(Deno.env.get('DB_URL')!));
 * ioc.Register(Repo, async (c) => new Repo(await c.Resolve(Config)));
 *
 * const repo = await ioc.Resolve(Repo);
 * ```
 */
export class IoCContainer {
  /** Registrations by symbol, then by name. */
  public services: IoCServices;

  /** Symbols handed out by {@link IoCContainer.Symbol}. */
  public symbols: Map<string, symbol>;

  /**
   * Registrations keyed by their exact class, so two different classes that share a name do not
   * resolve each other's instances. The name-based bank in `services` stays authoritative for
   * symbol lookups and for classes the container has not seen.
   */
  protected readonly byCtor: Map<Function, Map<string, unknown>>;

  constructor() {
    this.services = new Map<symbol, Map<string, IoCServiceResolutions>>();

    this.symbols = new Map<string, symbol>();

    this.byCtor = new Map();

    Object.defineProperty(this, IOC_PROTOCOL, { value: IOC_PROTOCOL_VERSION });
  }

  /**
   * Copies every registration into `ioc`, replacing registrations it already has with the same
   * symbol and name. Singletons are shared (both containers resolve the same instance) and
   * transient factories receive the container they are resolved from.
   */
  public CopyTo(ioc: IoCContainer): void {
    const target = ioc as Indexable;

    const protocolAware = (target?.[IOC_PROTOCOL] ?? 0) >= 1;

    for (const [symbol, bank] of this.services) {
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

    // RegisterDirect already tracked the classes that own their name bank entries; this carries
    // over same-named classes whose entries were shadowed by a later registration.
    if (protocolAware && typeof target.trackCtor === 'function') {
      for (const [ctor, entries] of this.byCtor) {
        for (const [name, entry] of entries) {
          target.trackCtor(ctor, name, entry);
        }
      }
    }
  }

  /** Resolves a class registration. */
  public async Resolve<T>(ctor: IoCServiceConstructor<T>): Promise<T>;

  /** Resolves a named class registration. */
  public async Resolve<T>(
    ctor: IoCServiceConstructor<T>,
    name: string,
  ): Promise<T>;

  /** Resolves a symbol registration. */
  public async Resolve<T>(symbol: symbol): Promise<T>;

  /** Resolves a named symbol registration. */
  public async Resolve<T>(symbol: symbol, name: string): Promise<T>;

  public async Resolve<T>(
    ctorSymbol: IoCServiceConstructor<T> | symbol,
    name?: string,
  ): Promise<T> {
    const frame = (this as Indexable)[IOC_CONTEXT] as IoCResolveFrame | undefined;

    const entry = this.lookup(ctorSymbol, name ?? DEFAULT_NAME, frame);

    return (await this.realize(entry, frame)) as T;
  }

  /**
   * Returns the raw stored entry for a registration without creating anything. Prefer
   * {@link IoCContainer.Resolve}; this exists for container-to-container copying.
   */
  public ResolveDirect<T>(
    ctorSymbol: IoCServiceConstructor<T> | symbol,
    name?: string,
  ): IoCServiceResolutions {
    const frame = (this as Indexable)[IOC_CONTEXT] as IoCResolveFrame | undefined;

    return this.lookup(ctorSymbol, name ?? DEFAULT_NAME, frame) as IoCServiceResolutions;
  }

  /**
   * Registers `clazz` as a scoped service; returns a function that removes the registration.
   */
  public Register<T>(
    clazz: IoCServiceConstructor<T>,
    options: IoCServiceOptions & { Lifetime: 'scoped' },
  ): () => void;

  /**
   * Registers a scoped factory (`options.Type` is required); returns a function that removes the
   * registration.
   */
  public Register<T>(
    instance: IoCServiceResolver<T>,
    options: IoCServiceOptions & { Lifetime: 'scoped' },
  ): () => void;

  /**
   * Registers `clazz` as a scoped service created by `instance`; returns a function that removes
   * the registration.
   */
  public Register<T>(
    clazz: IoCServiceConstructor<T>,
    instance: IoCServiceResolver<T>,
    options: IoCServiceOptions & { Lifetime: 'scoped' },
  ): () => void;

  /** Registers a class, keyed by the class (or `options.Type`). */
  public Register<T>(
    clazz: IoCServiceConstructor<T>,
    options?: IoCServiceOptions,
  ): void | (() => void);

  /** Registers a factory; `options.Type` is required. */
  public Register<T>(
    instance: IoCServiceResolver<T>,
    options?: IoCServiceOptions,
  ): void | (() => void);

  /** Registers a factory keyed by `clazz` (or `options.Type`). */
  public Register<T>(
    clazz: IoCServiceConstructor<T>,
    instance: IoCServiceResolver<T>,
    options?: IoCServiceOptions,
  ): void | (() => void);

  public Register<T>(
    clazzInstance: IoCServiceConstructor<T> | IoCServiceResolver<T>,
    instanceOptions?: IoCServiceResolver<T> | IoCServiceOptions,
    options?: IoCServiceOptions,
  ): void | (() => void) {
    let clazz: Function | undefined;
    let factory: (ioc: IoCContainer) => unknown;
    let opts: IoCServiceOptions;

    if (isClassLike(clazzInstance)) {
      clazz = clazzInstance;

      if (typeof instanceOptions === 'function') {
        factory = instanceOptions as IoCServiceResolver<T>;
        opts = { ...options };
      } else {
        const ctor = clazzInstance as IoCServiceConstructor<T>;
        factory = () => new ctor();
        opts = { ...(instanceOptions as IoCServiceOptions | undefined) };
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

    const ctorKeyed = !!clazz && opts.Type === Symbol.for(clazz.name);

    return this.addRegistration({
      symbol: opts.Type,
      name: opts.Name || DEFAULT_NAME,
      lifetime: opts.Lifetime ?? 'singleton',
      kind: typeof instanceOptions === 'function' || !clazz ? 'factory' : 'class',
      ctor: ctorKeyed ? clazz : undefined,
      factory,
      lazy: !!opts.Lazy,
    });
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

  //#region Internals

  /** The real container behind a context view (or this container). */
  protected self(): IoCContainer {
    return (this as Indexable)[IOC_SELF] ?? this;
  }

  /** The name bank for `symbol`, created on demand for any symbol. */
  protected bank(symbol: symbol): Map<string, IoCServiceResolutions> {
    let bank = this.services.get(symbol);

    if (!bank) {
      bank = new Map();
      this.services.set(symbol, bank);
    }

    return bank;
  }

  protected trackCtor(ctor: Function, name: string, entry: unknown): void {
    let entries = this.byCtor.get(ctor);

    if (!entries) {
      entries = new Map();
      this.byCtor.set(ctor, entries);
    }

    entries.set(name, entry);
  }

  protected untrackCtor(ctor: Function, name: string, entry: unknown): void {
    const entries = this.byCtor.get(ctor);

    if (entries && entries.get(name) === entry) {
      entries.delete(name);

      if (!entries.size) this.byCtor.delete(ctor);
    }
  }

  /** Finds the stored entry for a key, never mutating the container. */
  protected lookup(
    key: Function | symbol,
    name: string,
    frame: IoCResolveFrame | undefined,
  ): unknown {
    const self = this.self();

    const symbol = typeof key === 'symbol' ? key : Symbol.for(key.name);

    const bank = self.services.get(symbol);

    if (bank?.has(name)) {
      const entry = bank.get(name);

      if (typeof key === 'function') {
        const reg = registrationOf(entry);

        // A different class with the same name owns the name bank entry; prefer this class's
        // own registration when there is one.
        if (reg?.ctor && reg.ctor !== key) {
          const own = self.byCtor.get(key);

          if (own?.has(name)) return own.get(name);
        }
      }

      return entry;
    }

    throw new IoCServiceNotFoundError(
      symbol,
      name,
      bank ? [...bank.keys()] : [],
      framePath(frame),
    );
  }

  /** Turns a stored entry into the service value (or a promise of it). */
  protected realize(entry: unknown, frame: IoCResolveFrame | undefined): unknown {
    const reg = registrationOf(entry);

    if (reg) return reg.resolveIn(this.self(), frame);

    // Legacy thunks stored through RegisterDirect (for example by an older container's CopyTo).
    if (typeof entry === 'function' && !entry.name) {
      return (entry as (ioc: IoCContainer) => unknown)(this.self());
    }

    return entry;
  }

  /** Creates, stores and (unless lazy or transient) eagerly builds a registration. */
  protected addRegistration(spec: {
    symbol: symbol;
    name: string;
    lifetime: IoCLifetime;
    kind: 'class' | 'factory' | 'value';
    ctor?: Function;
    factory: (ioc: IoCContainer) => unknown;
    lazy: boolean;
  }): void | (() => void) {
    const self = this.self();

    const { symbol, name, lifetime, factory } = spec;

    const holder: IoCHolder | undefined = lifetime === 'transient' ? undefined : { state: 'empty' };

    const label = labelFor(symbol, name);

    const run = (container: object, parent: IoCResolveFrame | undefined, key: object) => {
      const frame: IoCResolveFrame = { key, label, parent, settled: false };

      let result: unknown;

      try {
        result = factory(createView(container, frame) as IoCContainer);
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
      resolveIn(container: object, frame?: IoCResolveFrame): unknown {
        if (!holder) {
          if (isOnActivePath(frame, reg)) {
            throw new IoCCircularDependencyError([...framePath(frame), label]);
          }

          return run(container, frame, reg);
        }

        if (holder.state === 'ready') return holder.value;

        if (holder.state === 'pending') {
          // A synchronous factory re-entering itself, or a chain waiting on its own result.
          if (!holder.promise || isOnActivePath(frame, holder)) {
            throw new IoCCircularDependencyError([...framePath(frame), label]);
          }

          // A caller should not inherit the failure of the attempt made at registration time
          // (typically a dependency registered later); retry once on its behalf.
          if (holder.eager) {
            return holder.promise.catch(() => reg.resolveIn(container, frame));
          }

          return holder.promise;
        }

        holder.state = 'pending';

        let result: unknown;

        try {
          // Singletons always build against their owner, never against whoever resolved them.
          result = run(self, frame, holder);
        } catch (err) {
          holder.state = 'empty';
          throw err;
        }

        return settleInto(holder, result);
      },
    };

    const thunk = createThunk(reg);

    if (holder && !spec.lazy) {
      // Eager: build now against the real container (as before). A synchronous throw propagates
      // and leaves any previous registration in place; an async rejection resets the holder so
      // the next Resolve retries (for example once a dependency has been registered).
      holder.state = 'pending';

      let result: unknown;

      try {
        result = factory(self);
      } catch (err) {
        holder.state = 'empty';
        throw err;
      }

      settleInto(holder, result);

      holder.eager = holder.state === 'pending';
    }

    self.RegisterDirect(symbol, name, thunk as unknown as IoCServiceConstructed);

    if (lifetime === 'scoped') {
      return () => {
        const bank = self.services.get(symbol);

        // Only remove the registration this call created, not a later re-registration.
        if (bank && bank.get(name) === (thunk as unknown)) {
          bank.delete(name);
        }

        if (spec.ctor) self.untrackCtor(spec.ctor, name, thunk);
      };
    }
  }

  //#endregion
}
