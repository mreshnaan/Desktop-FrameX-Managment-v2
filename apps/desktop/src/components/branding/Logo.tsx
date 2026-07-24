import { branding } from '@/config/branding';
import { cn } from '@/lib/utils';

// Renders branding.logo -- an <img> if configured as an image, otherwise a
// short-name badge placeholder. Matches FrameX's ui/components/Logo.tsx.
export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 overflow-hidden', className)}>
      {branding.logo.type === 'image' ? (
        <img src={branding.logo.src} alt={branding.appName} className="h-6 w-6 shrink-0 rounded" />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          {branding.appShortName.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="truncate text-lg font-semibold group-data-[collapsible=icon]:hidden">
        {branding.appName}
      </span>
    </div>
  );
}
