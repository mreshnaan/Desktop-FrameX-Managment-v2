// Single source of truth for the app's display name -- change it here, not
// in individual components. Matches apps/desktop's config/branding.ts (web
// doesn't need the theme/logo fields desktop has, since it has no Logo
// component or per-app theming).
export interface Branding {
  appName: string;
  appShortName: string;
  currencySymbol: string;
}

export const branding: Branding = {
  appName: 'FrameX Management',
  appShortName: 'FrameX',
  currencySymbol: 'Rs. ',
};
