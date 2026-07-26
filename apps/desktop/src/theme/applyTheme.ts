import { branding, type ThemeTokens } from '@/config/branding';

const CSS_VAR_MAP: Record<keyof ThemeTokens, string> = {
  background: '--background', foreground: '--foreground',
  card: '--card', cardForeground: '--card-foreground',
  popover: '--popover', popoverForeground: '--popover-foreground',
  primary: '--primary', primaryForeground: '--primary-foreground',
  secondary: '--secondary', secondaryForeground: '--secondary-foreground',
  muted: '--muted', mutedForeground: '--muted-foreground',
  accent: '--accent', accentForeground: '--accent-foreground',
  destructive: '--destructive',
  border: '--border', input: '--input', ring: '--ring',
  chart1: '--chart-1', chart2: '--chart-2', chart3: '--chart-3',
  chart4: '--chart-4', chart5: '--chart-5',
  sidebar: '--sidebar', sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary', sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent', sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border', sidebarRing: '--sidebar-ring',
};

// Writes the active theme's tokens onto :root as CSS custom properties.
// Called once at startup; re-call with a different mode for a future toggle.
export function applyTheme(mode: 'light' | 'dark' = 'light') {
  const tokens = branding.theme[mode];
  const root = document.documentElement;
  for (const key of Object.keys(CSS_VAR_MAP) as (keyof ThemeTokens)[]) {
    root.style.setProperty(CSS_VAR_MAP[key], tokens[key]);
  }
}
