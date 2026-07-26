// Single source of truth for the app's display name -- change it here, not
// in individual components.
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
