/** Dark, data-dense palette: this is a spreadsheet with drama, not a toy. */
export const colors = {
  bg: '#0E1116',
  surface: '#161B22',
  surfaceAlt: '#1C232D',
  border: '#2A3340',
  borderBright: '#3A4553',

  text: '#E6EDF3',
  muted: '#8B98A9',
  faint: '#5A6673',

  accent: '#3FB950',
  accentDim: '#1F6F35',
  gold: '#E3B341',
  warn: '#D29922',
  danger: '#F85149',
  info: '#58A6FF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

/** Ability and condition share a scale, so they share a colour ramp. */
export function ratingColor(value: number): string {
  if (value >= 82) return colors.accent;
  if (value >= 72) return '#7EE787';
  if (value >= 62) return colors.gold;
  if (value >= 50) return colors.warn;
  return colors.danger;
}

export function conditionColor(condition: number): string {
  if (condition >= 85) return colors.accent;
  if (condition >= 70) return colors.gold;
  if (condition >= 55) return colors.warn;
  return colors.danger;
}

export function formColor(form: number): string {
  if (form >= 3) return colors.accent;
  if (form <= -3) return colors.danger;
  return colors.muted;
}

/** Position groups get a colour so a squad list can be scanned at a glance. */
export function positionColor(position: string): string {
  if (position === 'GK') return colors.gold;
  if (['CB', 'LB', 'RB'].includes(position)) return colors.info;
  if (['DM', 'CM', 'AM'].includes(position)) return colors.accent;
  return colors.danger;
}
