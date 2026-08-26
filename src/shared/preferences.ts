export type ThemePref = "system" | "light" | "dark";

/**
 * Which pair of colours carries up and down on a chart.
 *
 * `classic` is green and red, which every finance product uses and which
 * measures a deuteranopia separation of ΔE 8.6 — over the ≥8 floor, but only
 * just, and only because the marks hold the 600 step in both themes rather than
 * lightening in dark. `accessible` swaps to teal and orange, which measures
 * 13.8 and has real headroom.
 *
 * Neither is relied on alone: direction is always carried by the sign and by
 * position against the baseline as well as by hue.
 */
export type DirectionPalette = "classic" | "accessible";

export interface UserPreferences {
  theme?: ThemePref;
  pageSize?: 10 | 20 | 50;
  directionPalette?: DirectionPalette;
}

export const DEFAULT_DIRECTION_PALETTE: DirectionPalette = "classic";

export const DEFAULT_PAGE_SIZE = 20;
