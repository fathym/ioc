/**
 * Decorating services: wrap an existing registration with timing and caching, without touching
 * the original service or its registration.
 *
 * Run: deno run examples/decorators.ts
 */
import { IoCContainer, IoCToken } from '../mod.ts';

interface Prices {
  quote(symbol: string): Promise<number>;
}

const $Prices = IoCToken<Prices, 'Prices'>('Prices');

let upstreamCalls = 0;

const ioc = new IoCContainer();

ioc.RegisterFactory($Prices, () => ({
  quote: (symbol) => Promise.resolve(++upstreamCalls && symbol.length * 10),
}));

// 1. Cache quotes.
ioc.Decorate($Prices, (inner) => {
  const cache = new Map<string, Promise<number>>();

  return {
    quote: (symbol) => {
      if (!cache.has(symbol)) cache.set(symbol, inner.quote(symbol));
      return cache.get(symbol)!;
    },
  };
});

// 2. Log timings around the cached service (decorators wrap in the order they are added).
const log: string[] = [];

ioc.Decorate($Prices, (inner) => ({
  quote: async (symbol) => {
    const started = performance.now();
    const price = await inner.quote(symbol);
    log.push(`${symbol}: ${price} in ${(performance.now() - started).toFixed(2)}ms`);
    return price;
  },
}));

const prices = await ioc.Resolve($Prices);

await prices.quote('DENO');
await prices.quote('DENO');
await prices.quote('JSR');

console.log(log.join('\n'));

if (upstreamCalls !== 2) throw new Error(`expected 2 upstream calls, got ${upstreamCalls}`);
