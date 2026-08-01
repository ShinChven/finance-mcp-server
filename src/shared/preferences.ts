export type ThemePref = "system" | "light" | "dark";

export interface UserPreferences {
  theme?: ThemePref;
  pageSize?: 10 | 20 | 50;
}

export const DEFAULT_PAGE_SIZE = 20;
