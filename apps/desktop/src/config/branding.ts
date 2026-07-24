// Config-driven branding/theme, matching FrameX's config/branding.ts pattern
// and exact token values -- swap `logo`/`theme` here to re-skin the app
// without touching component code. See src/theme/applyTheme.ts for how
// these tokens reach the DOM.

export interface ThemeTokens {
  background: string; foreground: string;
  card: string; cardForeground: string;
  popover: string; popoverForeground: string;
  primary: string; primaryForeground: string;
  secondary: string; secondaryForeground: string;
  muted: string; mutedForeground: string;
  accent: string; accentForeground: string;
  destructive: string;
  border: string; input: string; ring: string;
  chart1: string; chart2: string; chart3: string; chart4: string; chart5: string;
  sidebar: string; sidebarForeground: string;
  sidebarPrimary: string; sidebarPrimaryForeground: string;
  sidebarAccent: string; sidebarAccentForeground: string;
  sidebarBorder: string; sidebarRing: string;
}

export type LogoConfig = { type: 'placeholder' } | { type: 'image'; src: string };

export interface Branding {
  appName: string;
  appShortName: string;
  logo: LogoConfig;
  theme: { light: ThemeTokens; dark: ThemeTokens };
}

export const branding: Branding = {
  appName: 'Cue Room',
  appShortName: 'Cue Room',
  logo: { type: 'placeholder' },
  theme: {
    light: {
      background: 'oklch(1 0 0)', foreground: 'oklch(0.145 0 0)',
      card: 'oklch(1 0 0)', cardForeground: 'oklch(0.145 0 0)',
      popover: 'oklch(1 0 0)', popoverForeground: 'oklch(0.145 0 0)',
      primary: 'oklch(0.205 0 0)', primaryForeground: 'oklch(0.985 0 0)',
      secondary: 'oklch(0.97 0 0)', secondaryForeground: 'oklch(0.205 0 0)',
      muted: 'oklch(0.97 0 0)', mutedForeground: 'oklch(0.556 0 0)',
      accent: 'oklch(0.97 0 0)', accentForeground: 'oklch(0.205 0 0)',
      destructive: 'oklch(0.577 0.245 27.325)',
      border: 'oklch(0.922 0 0)', input: 'oklch(0.922 0 0)', ring: 'oklch(0.708 0 0)',
      chart1: 'oklch(0.87 0 0)', chart2: 'oklch(0.556 0 0)', chart3: 'oklch(0.439 0 0)',
      chart4: 'oklch(0.371 0 0)', chart5: 'oklch(0.269 0 0)',
      sidebar: 'oklch(0.985 0 0)', sidebarForeground: 'oklch(0.145 0 0)',
      sidebarPrimary: 'oklch(0.205 0 0)', sidebarPrimaryForeground: 'oklch(0.985 0 0)',
      sidebarAccent: 'oklch(0.97 0 0)', sidebarAccentForeground: 'oklch(0.205 0 0)',
      sidebarBorder: 'oklch(0.922 0 0)', sidebarRing: 'oklch(0.708 0 0)',
    },
    dark: {
      background: 'oklch(0.145 0 0)', foreground: 'oklch(0.985 0 0)',
      card: 'oklch(0.205 0 0)', cardForeground: 'oklch(0.985 0 0)',
      popover: 'oklch(0.205 0 0)', popoverForeground: 'oklch(0.985 0 0)',
      primary: 'oklch(0.922 0 0)', primaryForeground: 'oklch(0.205 0 0)',
      secondary: 'oklch(0.269 0 0)', secondaryForeground: 'oklch(0.985 0 0)',
      muted: 'oklch(0.269 0 0)', mutedForeground: 'oklch(0.708 0 0)',
      accent: 'oklch(0.269 0 0)', accentForeground: 'oklch(0.985 0 0)',
      destructive: 'oklch(0.704 0.191 22.216)',
      border: 'oklch(1 0 0 / 10%)', input: 'oklch(1 0 0 / 15%)', ring: 'oklch(0.556 0 0)',
      chart1: 'oklch(0.87 0 0)', chart2: 'oklch(0.556 0 0)', chart3: 'oklch(0.439 0 0)',
      chart4: 'oklch(0.371 0 0)', chart5: 'oklch(0.269 0 0)',
      sidebar: 'oklch(0.205 0 0)', sidebarForeground: 'oklch(0.985 0 0)',
      sidebarPrimary: 'oklch(0.488 0.243 264.376)', sidebarPrimaryForeground: 'oklch(0.985 0 0)',
      sidebarAccent: 'oklch(0.269 0 0)', sidebarAccentForeground: 'oklch(0.985 0 0)',
      sidebarBorder: 'oklch(1 0 0 / 10%)', sidebarRing: 'oklch(0.556 0 0)',
    },
  },
};
