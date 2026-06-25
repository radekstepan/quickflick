import type { AccentColor, Theme } from './types';

export interface AccentVariants {
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentGlow: string;
  accentGlowSoft: string;
  primaryShadow: string;
}

export interface AccentPreset {
  label: string;
  swatch: string;
  dark: AccentVariants;
  light: AccentVariants;
}

export const ACCENT_COLORS: Record<AccentColor, AccentPreset> = {
  red: {
    label: 'Red',
    swatch: '#ff4757',
    dark: {
      accent: '#ff4757',
      accentHover: '#e63946',
      accentSoft: 'rgba(255, 71, 87, 0.12)',
      accentGlow: 'rgba(255, 71, 87, 0.18)',
      accentGlowSoft: 'rgba(255, 71, 87, 0.06)',
      primaryShadow: 'rgba(255, 71, 87, 0.3)'
    },
    light: {
      accent: '#e63946',
      accentHover: '#d12838',
      accentSoft: 'rgba(230, 57, 70, 0.10)',
      accentGlow: 'rgba(230, 57, 70, 0.18)',
      accentGlowSoft: 'rgba(230, 57, 70, 0.05)',
      primaryShadow: 'rgba(209, 40, 56, 0.20)'
    }
  },
  orange: {
    label: 'Orange',
    swatch: '#ff8c42',
    dark: {
      accent: '#ff8c42',
      accentHover: '#f97316',
      accentSoft: 'rgba(255, 140, 66, 0.12)',
      accentGlow: 'rgba(255, 140, 66, 0.18)',
      accentGlowSoft: 'rgba(255, 140, 66, 0.06)',
      primaryShadow: 'rgba(255, 140, 66, 0.3)'
    },
    light: {
      accent: '#ea580c',
      accentHover: '#c2410c',
      accentSoft: 'rgba(234, 88, 12, 0.10)',
      accentGlow: 'rgba(234, 88, 12, 0.18)',
      accentGlowSoft: 'rgba(234, 88, 12, 0.05)',
      primaryShadow: 'rgba(194, 65, 12, 0.20)'
    }
  },
  amber: {
    label: 'Amber',
    swatch: '#fbbf24',
    dark: {
      accent: '#fbbf24',
      accentHover: '#f59e0b',
      accentSoft: 'rgba(251, 191, 36, 0.12)',
      accentGlow: 'rgba(251, 191, 36, 0.18)',
      accentGlowSoft: 'rgba(251, 191, 36, 0.06)',
      primaryShadow: 'rgba(251, 191, 36, 0.3)'
    },
    light: {
      accent: '#d97706',
      accentHover: '#b45309',
      accentSoft: 'rgba(217, 119, 6, 0.10)',
      accentGlow: 'rgba(217, 119, 6, 0.18)',
      accentGlowSoft: 'rgba(217, 119, 6, 0.05)',
      primaryShadow: 'rgba(180, 83, 9, 0.20)'
    }
  },
  green: {
    label: 'Green',
    swatch: '#4ade80',
    dark: {
      accent: '#4ade80',
      accentHover: '#22c55e',
      accentSoft: 'rgba(74, 222, 128, 0.12)',
      accentGlow: 'rgba(74, 222, 128, 0.18)',
      accentGlowSoft: 'rgba(74, 222, 128, 0.06)',
      primaryShadow: 'rgba(74, 222, 128, 0.3)'
    },
    light: {
      accent: '#16a34a',
      accentHover: '#15803d',
      accentSoft: 'rgba(22, 163, 74, 0.10)',
      accentGlow: 'rgba(22, 163, 74, 0.18)',
      accentGlowSoft: 'rgba(22, 163, 74, 0.05)',
      primaryShadow: 'rgba(21, 128, 61, 0.20)'
    }
  },
  teal: {
    label: 'Teal',
    swatch: '#2dd4bf',
    dark: {
      accent: '#2dd4bf',
      accentHover: '#14b8a6',
      accentSoft: 'rgba(45, 212, 191, 0.12)',
      accentGlow: 'rgba(45, 212, 191, 0.18)',
      accentGlowSoft: 'rgba(45, 212, 191, 0.06)',
      primaryShadow: 'rgba(45, 212, 191, 0.3)'
    },
    light: {
      accent: '#0d9488',
      accentHover: '#0f766e',
      accentSoft: 'rgba(13, 148, 136, 0.10)',
      accentGlow: 'rgba(13, 148, 136, 0.18)',
      accentGlowSoft: 'rgba(13, 148, 136, 0.05)',
      primaryShadow: 'rgba(15, 118, 110, 0.20)'
    }
  },
  blue: {
    label: 'Blue',
    swatch: '#60a5fa',
    dark: {
      accent: '#60a5fa',
      accentHover: '#3b82f6',
      accentSoft: 'rgba(96, 165, 250, 0.12)',
      accentGlow: 'rgba(96, 165, 250, 0.18)',
      accentGlowSoft: 'rgba(96, 165, 250, 0.06)',
      primaryShadow: 'rgba(96, 165, 250, 0.3)'
    },
    light: {
      accent: '#2563eb',
      accentHover: '#1d4ed8',
      accentSoft: 'rgba(37, 99, 235, 0.10)',
      accentGlow: 'rgba(37, 99, 235, 0.18)',
      accentGlowSoft: 'rgba(37, 99, 235, 0.05)',
      primaryShadow: 'rgba(29, 78, 216, 0.20)'
    }
  },
  indigo: {
    label: 'Indigo',
    swatch: '#818cf8',
    dark: {
      accent: '#818cf8',
      accentHover: '#6366f1',
      accentSoft: 'rgba(129, 140, 248, 0.12)',
      accentGlow: 'rgba(129, 140, 248, 0.18)',
      accentGlowSoft: 'rgba(129, 140, 248, 0.06)',
      primaryShadow: 'rgba(129, 140, 248, 0.3)'
    },
    light: {
      accent: '#4f46e5',
      accentHover: '#4338ca',
      accentSoft: 'rgba(79, 70, 229, 0.10)',
      accentGlow: 'rgba(79, 70, 229, 0.18)',
      accentGlowSoft: 'rgba(79, 70, 229, 0.05)',
      primaryShadow: 'rgba(67, 56, 202, 0.20)'
    }
  },
  pink: {
    label: 'Pink',
    swatch: '#f472b6',
    dark: {
      accent: '#f472b6',
      accentHover: '#ec4899',
      accentSoft: 'rgba(244, 114, 182, 0.12)',
      accentGlow: 'rgba(244, 114, 182, 0.18)',
      accentGlowSoft: 'rgba(244, 114, 182, 0.06)',
      primaryShadow: 'rgba(244, 114, 182, 0.3)'
    },
    light: {
      accent: '#db2777',
      accentHover: '#be185d',
      accentSoft: 'rgba(219, 39, 119, 0.10)',
      accentGlow: 'rgba(219, 39, 119, 0.18)',
      accentGlowSoft: 'rgba(219, 39, 119, 0.05)',
      primaryShadow: 'rgba(190, 24, 93, 0.20)'
    }
  }
};

export const ACCENT_COLOR_IDS: AccentColor[] = [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'pink'
];

export const DEFAULT_ACCENT_COLOR: AccentColor = 'red';

export function isAccentColor(value: string): value is AccentColor {
  return value in ACCENT_COLORS;
}

export function variantsFor(
  color: AccentColor,
  theme: Theme
): AccentVariants {
  return ACCENT_COLORS[color][theme];
}
