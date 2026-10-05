import type { Position } from '@eleven-deep/engine';

/** Every position as a filter chip, plus All. Shared so the market reads the same everywhere. */
export const POSITION_FILTERS: { value: Position | 'any'; label: string }[] = [
  { value: 'any', label: 'All' },
  ...(['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const).map((p) => ({ value: p, label: p })),
];
