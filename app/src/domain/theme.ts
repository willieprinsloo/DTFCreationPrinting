/** What Settings › General offers; `system` follows the computer's light/dark setting. */
export type ThemeChoice = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_CHOICES: ThemeChoice[] = ['system', 'light', 'dark']
export const isThemeChoice = (v: unknown): v is ThemeChoice => THEME_CHOICES.includes(v as ThemeChoice)

/** How the film is drawn behind the designs: white, or dark so white and pale designs show. */
export type FilmShade = 'light' | 'dark'
export const isFilmShade = (v: unknown): v is FilmShade => v === 'light' || v === 'dark'

/** Film, grid and margin colours for each shade. */
export const FILM_COLOURS: Record<FilmShade, { film: string; grid: string; margin: string }> = {
  light: { film: '#ffffff', grid: 'rgba(28, 35, 48, 0.08)', margin: 'rgba(28, 35, 48, 0.08)' },
  dark: { film: '#2a2f37', grid: 'rgba(255, 255, 255, 0.07)', margin: 'rgba(255, 255, 255, 0.08)' },
}

export const effectiveTheme = (choice: ThemeChoice, systemDark: boolean): Theme =>
  choice === 'system' ? (systemDark ? 'dark' : 'light') : choice
