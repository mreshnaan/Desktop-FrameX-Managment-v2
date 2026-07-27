import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({ title, subtitle, children }: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(v => !v)}
      >
        <span className="flex items-center gap-2">
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', collapsed && '-rotate-90')} />
          <h2 className="text-lg font-semibold">{title}</h2>
        </span>
        {subtitle && <span className="text-sm font-medium text-muted-foreground">{subtitle}</span>}
      </button>
      {!collapsed && children}
    </section>
  );
}
