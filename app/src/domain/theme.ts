/** What Settings › General offers; `system` follows the computer's light/dark setting. */
export type ThemeChoice = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_CHOICES: ThemeChoice[] = ['system', 'light', 'dark']
export const isThemeChoice = (v: unknown): v is ThemeChoice => THEME_CHOICES.includes(v as ThemeChoice)

export const effectiveTheme = (choice: ThemeChoice, systemDark: boolean): Theme =>
  choice === 'system' ? (systemDark ? 'dark' : 'light') : choice
