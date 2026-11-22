export const LAYOUTS = {
  classic: { name: 'Cadence Classic', description: 'Pick a date, then a time.' },
  week: { name: 'Week', description: 'Compare times across seven days.' },
  agenda: { name: 'Agenda', description: 'Browse available days in order.' },
} as const

export const THEME_BEHAVIOURS = {
  light: 'Always light',
  dark: 'Always dark',
  website: 'Follow website',
  independent: 'Independent',
} as const
export type ThemeBehaviour = keyof typeof THEME_BEHAVIOURS

export interface BookingAppearance {
  themeBehaviour?: ThemeBehaviour
  layout: keyof typeof LAYOUTS
  accent: string | null
  background: string | null
  /** Older installations used the same colours in both modes. */
  dark?: { accent: string | null; background: string | null }
  logoKey: string | null
}

export const CLASSIC: BookingAppearance = { themeBehaviour: 'light', layout: 'classic', accent: null, background: null, logoKey: null }

export function isColour(value: string): boolean {
  return /^#[\da-f]{6}$/i.test(value)
}

/** Choose whichever of black and white gives the higher WCAG contrast. */
export function colourInk(colour: string): string {
  const channels = [1, 3, 5].map(offset => Number.parseInt(colour.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = channels.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.179 ? '#000000' : '#ffffff'
}
