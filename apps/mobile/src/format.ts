/**
 * Small display formatters shared across screens.
 *
 * The engine keeps its own private `ordinal` for the board's verdict prose
 * (`career/board.ts`). That is deliberate: exporting a string formatter across
 * the package boundary would widen the engine's public API to save four lines,
 * and the engine's output is read by the CLI harness as well as the app.
 */

/** 1st, 2nd, 3rd, 4th — with the 11th/12th/13th exception English insists on. */
export function ordinal(n: number): string {
  const teens = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teens ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}
