/**
 * SeededRNG — deterministic pseudo-random number generator for the AI pipeline.
 *
 * Implementation: xorshift128+ (Vigna 2014). Four-line state advance, well-distributed,
 * fast, and good enough for card-game MCTS rollouts. Hand-rolled to avoid an npm dep.
 *
 * Why not Math.random monkey-patch:
 *   Phase 2 introduces a worker pool. Monkey-patching Math.random is global state,
 *   which would break determinism across parallel workers.
 *
 * Citation: Hearthstone paper §V uses a seedable RNG with the same approach (replacing
 * Math.random in the engine). See arXiv:2303.05197.
 *
 * Design decision DD2 (Phase 1 plan 01-01): xorshift128+, no deps.
 *
 * Implementation note: this file uses BigInt() constructor calls rather than `123n`
 * literal syntax because the engine's tsconfig targets ES2017, and jasmine-ts/ts-node
 * rejects BigInt literals at lower targets. The runtime supports BigInt regardless
 * (Node 18+).
 */

export class SeededRNG {

  // 128 bits of state stored in two BigInts. xorshift128+ requires 128 bits.
  private s0: bigint;
  private s1: bigint;

  // BigInt constants — built once at module load via the BigInt() constructor so
  // we don't need ES2020-target literal syntax.
  private static readonly MASK64 = (BigInt(1) << BigInt(64)) - BigInt(1);
  private static readonly MASK53 = (BigInt(1) << BigInt(53)) - BigInt(1);
  private static readonly TWO_POW_53 = BigInt(1) << BigInt(53);
  private static readonly SPLITMIX_GAMMA = BigInt('0x9E3779B97F4A7C15');
  private static readonly SPLITMIX_M1 = BigInt('0xBF58476D1CE4E5B9');
  private static readonly SPLITMIX_M2 = BigInt('0x94D049BB133111EB');
  private static readonly THIRTY = BigInt(30);
  private static readonly TWENTY_SEVEN = BigInt(27);
  private static readonly THIRTY_ONE = BigInt(31);
  private static readonly TWENTY_THREE = BigInt(23);
  private static readonly SEVENTEEN = BigInt(17);
  private static readonly TWENTY_SIX = BigInt(26);
  private static readonly ELEVEN = BigInt(11);
  private static readonly LOWER_32 = BigInt('0xFFFFFFFF');
  private static readonly ZERO = BigInt(0);
  private static readonly ONE = BigInt(1);

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new Error(`SeededRNG: seed must be finite, got ${seed}`);
    }
    // Initialize state from seed using two splitmix64 steps so adjacent seeds
    // produce decorrelated state.
    let x = BigInt(Math.trunc(seed)) & SeededRNG.MASK64;
    this.s0 = SeededRNG.splitmix64(x);
    x = (x + SeededRNG.SPLITMIX_GAMMA) & SeededRNG.MASK64;
    this.s1 = SeededRNG.splitmix64(x);
    // Guarantee state is non-zero (xorshift family requirement).
    if (this.s0 === SeededRNG.ZERO && this.s1 === SeededRNG.ZERO) {
      this.s0 = SeededRNG.ONE;
    }
  }

  /**
   * Advance state and return a uniformly distributed double in [0, 1).
   * Uses the upper 53 bits of the xorshift128+ output (the precision of a JS double).
   */
  public next(): number {
    const out = this.advance();
    const top53 = (out >> SeededRNG.ELEVEN) & SeededRNG.MASK53;
    return Number(top53) / Number(SeededRNG.TWO_POW_53);
  }

  /**
   * Returns an integer in [0, n). Throws if n is not a positive integer.
   */
  public nextInt(n: number): number {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`SeededRNG.nextInt: n must be a positive integer, got ${n}`);
    }
    return Math.floor(this.next() * n);
  }

  /**
   * Fork into an independent stream. The parent advances once, uses the output
   * as a seed for the new RNG, and the parent keeps advancing independently after.
   *
   * Used by Env.clone() so a cloned env has a deterministic-but-different rng
   * stream from the original.
   */
  public fork(): SeededRNG {
    const out = this.advance();
    // Use the lower 32 bits as the seed for the child to keep it within Number range.
    const childSeed = Number(out & SeededRNG.LOWER_32);
    return new SeededRNG(childSeed);
  }

  /**
   * One xorshift128+ step. Returns a uint64 (as bigint) and advances internal state.
   */
  private advance(): bigint {
    let s1 = this.s0;
    const s0 = this.s1;
    this.s0 = s0;
    s1 = (s1 ^ (s1 << SeededRNG.TWENTY_THREE)) & SeededRNG.MASK64;
    this.s1 = (s1 ^ s0 ^ (s1 >> SeededRNG.SEVENTEEN) ^ (s0 >> SeededRNG.TWENTY_SIX)) & SeededRNG.MASK64;
    return (this.s1 + s0) & SeededRNG.MASK64;
  }

  /**
   * Splitmix64 — used only to initialize xorshift state from a single 64-bit seed.
   */
  private static splitmix64(seed: bigint): bigint {
    let z = (seed + SeededRNG.SPLITMIX_GAMMA) & SeededRNG.MASK64;
    z = ((z ^ (z >> SeededRNG.THIRTY)) * SeededRNG.SPLITMIX_M1) & SeededRNG.MASK64;
    z = ((z ^ (z >> SeededRNG.TWENTY_SEVEN)) * SeededRNG.SPLITMIX_M2) & SeededRNG.MASK64;
    z = z ^ (z >> SeededRNG.THIRTY_ONE);
    return z & SeededRNG.MASK64;
  }
}
