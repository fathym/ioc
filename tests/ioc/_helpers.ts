/** Resolves after `ms` milliseconds. */
export function delay(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Settles with `promise`, or rejects if it has not settled within `ms` — so a test for "throws
 * instead of hanging" fails fast instead of timing out the whole run.
 */
export async function withinTimeout<T>(promise: Promise<T>, ms = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms (hang)`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** A counter with a `next()` that returns the incremented value. */
export function counter(): { count: number; next(): number } {
  return {
    count: 0,
    next() {
      return ++this.count;
    },
  };
}

/** Small deterministic PRNG (mulberry32) for reproducible randomized tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
