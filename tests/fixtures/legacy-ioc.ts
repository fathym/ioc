// Frozen copy of the published @fathym/ioc 0.0.36 implementation (src/ioc/ioc.ts).
// Used to pin legacy behavior and to test interop between container versions
// that coexist in one process (dependents pin different exact versions).
// Do not edit.
// deno-lint-ignore-file
// deno-lint-ignore ban-types
export type IoCServiceConstructed = { constructor: Function };

// deno-lint-ignore no-explicit-any
export type IoCServiceConstructor<T> = { new (...args: any[]): T };

export type IoCServiceOptions = {
  Lazy?: boolean;

  Lifetime?: 'transient' | 'scoped';

  Name?: string;

  Type?: symbol;
};

export type IoCServiceResolutions =
  | IoCServiceConstructed
  | Promise<IoCServiceConstructed>
  | (() => IoCServiceConstructed | Promise<IoCServiceConstructed>);

export type IoCServiceResolver<T> = (ioc: LegacyIoCContainer) => T | Promise<T>;

export type IoCServices = Map<symbol, Map<string, IoCServiceResolutions>>;

// export type ServiceResult<T extends ServiceConstructor> = T | Promise<T>;

export class LegacyIoCContainer {
  public services: IoCServices;

  public symbols: Map<string, symbol>;

  constructor() {
    this.services = new Map<symbol, Map<string, IoCServiceResolutions>>();

    this.symbols = new Map<string, symbol>();
  }

  public CopyTo(ioc: LegacyIoCContainer): void {
    for (const svc of this.services) {
      const [symbol] = svc;

      for (const symBank of this.services.get(symbol)!) {
        const [name] = symBank;

        ioc.RegisterDirect(
          ioc.Symbol(symbol.description!),
          name,
          this.ResolveDirect(symbol, name),
        );
      }
    }
  }

  public async Resolve<T>(ctor: IoCServiceConstructor<T>): Promise<T>;

  public async Resolve<T>(
    ctor: IoCServiceConstructor<T>,
    name: string,
  ): Promise<T>;

  public async Resolve<T>(symbol: symbol): Promise<T>;

  public async Resolve<T>(symbol: symbol, name: string): Promise<T>;

  public async Resolve<T>(
    ctorSymbol: IoCServiceConstructor<T> | symbol,
    name?: string,
  ): Promise<T> {
    let svc = this.ResolveDirect(ctorSymbol, name);

    if (typeof svc === 'function' && !svc.name) {
      svc = svc();
    }

    if (svc instanceof Promise) {
      svc = await svc;
    }

    return svc as T;
  }

  public ResolveDirect<T>(
    ctorSymbol: IoCServiceConstructor<T> | symbol,
    name?: string,
  ): IoCServiceResolutions {
    let [symbol] = [ctorSymbol as symbol];

    if (typeof ctorSymbol !== 'symbol') {
      symbol = this.Symbol(ctorSymbol.name);
    }

    name ??= '$default';

    if (!this.services.get(symbol)!.has(name)) {
      throw new Error(
        `No Service for symbol '${symbol.description}' with name '${name}' has been registered.`,
      );
    }

    return this.services.get(symbol)!.get(name)!;
  }

  public Register<T>(
    clazz: IoCServiceConstructor<T>,
    options?: IoCServiceOptions,
  ): void | (() => void);

  public Register<T>(
    instance: IoCServiceResolver<T>,
    options?: IoCServiceOptions,
  ): void | (() => void);

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
    let [clazz, instance] = [
      clazzInstance as IoCServiceConstructor<T>,
      instanceOptions as IoCServiceResolver<T>,
    ];

    if (clazzInstance.name) {
      clazz = clazzInstance as IoCServiceConstructor<T>;

      instance = (_ioc) =>
        options?.Lazy
          ? new Promise<T>((resolve) => {
            queueMicrotask(() => resolve(new clazz()));
          })
          : new clazz();

      if (typeof instanceOptions !== 'function') {
        options = instanceOptions as IoCServiceOptions;
      } else {
        instance = instanceOptions as IoCServiceResolver<T>;
      }

      if (!options) {
        options = (instanceOptions as IoCServiceOptions) || {};
      }

      if (!options.Type) {
        options.Type = this.Symbol(clazz.name);
      }
    } else {
      instance = clazzInstance as IoCServiceResolver<T>;

      options = instanceOptions as IoCServiceOptions;
    }

    const symbol = options?.Type;

    if (!symbol) {
      throw new Error(
        `The Type was missing for the registration.`,
      );
    }

    const name = options?.Name || '$default';

    if (options?.Lifetime === 'transient') {
      this.RegisterDirect(symbol, name, () => {
        return instance(this) as IoCServiceConstructed;
      });
    } else if (options?.Lifetime === 'scoped') {
      const scope = new AbortController();

      scope.signal.onabort = (_e) => {
        this.services.get(symbol)!.delete(name);
      };

      this.RegisterDirect(
        symbol,
        name,
        instance(this) as IoCServiceConstructed,
      );

      return () => scope.abort();
    } else {
      this.RegisterDirect(
        symbol,
        name,
        instance(this) as IoCServiceConstructed,
      );
    }
  }

  public RegisterDirect(
    symbol: symbol,
    name: string,
    instance: IoCServiceConstructed,
  ): void | (() => void) {
    this.services.get(symbol)!.set(name, instance);
  }

  public Symbol(id: string): symbol {
    if (!this.symbols.has(id)) {
      this.symbols.set(id, Symbol.for(id));
    }

    const symbol = this.symbols.get(id)!;

    if (!this.services.has(symbol)) {
      this.services.set(symbol, new Map<string, IoCServiceResolutions>());
    }

    return symbol;
  }
}
