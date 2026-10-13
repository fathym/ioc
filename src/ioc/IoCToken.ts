/**
 * A symbol that carries the type of the service registered under it, so resolving it needs no
 * explicit generic:
 *
 * ```ts
 * export const $Db = IoCToken<Db>('Db');
 *
 * ioc.Register($Db, () => openDb());   // the factory must return a Db
 * const db = await ioc.Resolve($Db);   // db: Db
 * ```
 *
 * Tokens are plain `Symbol.for(id)` symbols at runtime, so `IoCToken('Db')` and `ioc.Symbol('Db')`
 * are interchangeable, and a plain symbol is accepted anywhere a token is.
 */
export type IoCToken<T> = symbol & {
  /** Type-only marker carrying the service type; never present at runtime. */
  readonly '@fathym/ioc/type'?: T;
};

/** Creates a typed token for `id` (the same symbol as `Symbol.for(id)` / `ioc.Symbol(id)`). */
export function IoCToken<T>(id: string): IoCToken<T> {
  return Symbol.for(id) as IoCToken<T>;
}

/** The service type carried by a token. */
export type IoCTokenOf<TToken> = TToken extends IoCToken<infer T> ? T : never;
