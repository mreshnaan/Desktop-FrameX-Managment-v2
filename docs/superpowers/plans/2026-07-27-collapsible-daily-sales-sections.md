# Collapsible Daily Sales Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each Daily Sales section (one per category — e.g. 8-Ball, Snooker,
PlayStation — plus, on desktop only, Cafe) gets a clickable header that
collapses/expands its contents independently, with a running subtotal that stays
visible even while collapsed.

**Architecture:** One task, both apps. A new small shared-per-app UI primitive
(`CollapsibleSection`, duplicated per app like `DataTable` and `data-table.tsx` in an
earlier sub-project — no cross-app package by design) wraps the existing
`CategoryGroup` body in both apps and desktop's `CafeSection` body. No data-layer
change — this is pure client-side UI state, one task is sufficient.

**Tech Stack:** TypeScript, React, Tailwind, `lucide-react` (already a dependency in
both apps).

## Global Constraints

- No persistence (`localStorage` or otherwise) — every section starts expanded on
  every page load/navigation. Collapsing is a same-visit convenience only.
- Each section's collapsed/expanded state is independent local component state —
  collapsing one section must never affect any other section.
- Desktop's Cafe section's existing inner "Show orders / Hide orders" toggle (a
  `useState` inside `CafeSection` itself) stays completely untouched — the new
  section-level collapse is a separate, outer control.
- Web's Daily Sales has no Cafe section at all (confirmed: no cafe/order code path in
  `apps/web/src/components/views/DailySalesView.tsx`) — only add collapsible category
  sections there, not a Cafe one.
- `data-testid` attributes already on `StationCard`'s `<Card>` (`resource-card-...`)
  and `CafeSection`'s `<Card>` (`cafe-summary-card`) must be preserved exactly — this
  refactor only changes the wrapping `<section>`/`<h2>` markup around them, not
  anything inside.
- Verify with `tsc -b` in both apps before committing (no data/test changes needed —
  pure UI).

---

### Task 1: `CollapsibleSection` component + wire into both apps' Daily Sales

**Files:**
- Create: `apps/desktop/src/components/ui/collapsible-section.tsx`
- Create: `apps/web/src/components/ui/collapsible-section.tsx`
- Modify: `apps/desktop/src/components/views/DailySalesView.tsx` (`CategoryGroup`,
  `CafeSection`)
- Modify: `apps/web/src/components/views/DailySalesView.tsx` (`CategoryGroup`)

**Interfaces:**
- Produces: `CollapsibleSection({ title, subtitle, children }: { title: string;
  subtitle?: ReactNode; children: ReactNode })` — renders its own `<section>`
  wrapper (call sites stop wrapping their own), a clickable header (chevron + title +
  subtitle), and toggles `children`'s visibility on click. `aria-expanded` on the
  header button reflects state.

- [ ] **Step 1: Create `apps/desktop/src/components/ui/collapsible-section.tsx`**

```tsx
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
```

- [ ] **Step 2: Create the identical `apps/web/src/components/ui/collapsible-section.tsx`**

Byte-identical to Step 1 — `cn` (`@/lib/utils`) and `lucide-react` are both already
dependencies in `apps/web` too.

- [ ] **Step 3: Wire into desktop's `CategoryGroup`**

In `apps/desktop/src/components/views/DailySalesView.tsx`, add the import:

```ts
import { CollapsibleSection } from '@/components/ui/collapsible-section';
```

Replace `CategoryGroup`'s body:

```tsx
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{category.name}</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {category.stations.map(station => (
          <StationCard
            key={station.id}
            date={date}
            category={category}
            station={station}
            sessions={sessionsByStationId.get(station.id) ?? []}
            customers={customers}
            addSession={addSession}
            updateSession={updateSession}
            deleteSession={deleteSession}
          />
        ))}
      </div>
    </section>
  );
}
```

with:

```tsx
  const categoryTotal = useMemo(
    () => category.stations.reduce(
      (sum, station) => sum + (sessionsByStationId.get(station.id) ?? []).reduce((s, session) => s + session.amount, 0),
      0,
    ),
    [category.stations, sessionsByStationId],
  );

  return (
    <CollapsibleSection title={category.name} subtitle={formatCurrency(categoryTotal)}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {category.stations.map(station => (
          <StationCard
            key={station.id}
            date={date}
            category={category}
            station={station}
            sessions={sessionsByStationId.get(station.id) ?? []}
            customers={customers}
            addSession={addSession}
            updateSession={updateSession}
            deleteSession={deleteSession}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}
```

(`useMemo` and `formatCurrency` are both already imported at the top of this file —
no new imports needed for this step beyond the `CollapsibleSection` import added
above.)

- [ ] **Step 4: Wire into desktop's `CafeSection`**

In the same file, replace `CafeSection`'s return statement:

```tsx
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Cafe</h2>
      <Card data-testid="cafe-summary-card">
```

with:

```tsx
  return (
    <CollapsibleSection title="Cafe" subtitle={formatCurrency(revenue)}>
      <Card data-testid="cafe-summary-card">
```

and its closing tags:

```tsx
      </Card>
    </section>
  );
}
```

with:

```tsx
      </Card>
    </CollapsibleSection>
  );
}
```

Everything between `<Card data-testid="cafe-summary-card">` and `</Card>` (the
revenue/profit header, the "Show orders"/"Hide orders" button and its `showOrders`
state, the order list) is untouched — only the outer wrapper changes.

- [ ] **Step 5: Wire into web's `CategoryGroup`**

In `apps/web/src/components/views/DailySalesView.tsx`, add the import:

```ts
import { CollapsibleSection } from '@/components/ui/collapsible-section';
```

Replace `CategoryGroup`'s body:

```tsx
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{category.name}</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {category.stations.map(station => (
          <StationCard
            key={station.id}
            category={category}
            station={station}
            sessions={sessionsByStationId.get(station.id) ?? []}
            customers={customers}
          />
        ))}
      </div>
    </section>
  );
}
```

with:

```tsx
  const categoryTotal = useMemo(
    () => category.stations.reduce(
      (sum, station) => sum + (sessionsByStationId.get(station.id) ?? []).reduce((s, session) => s + session.amount, 0),
      0,
    ),
    [category.stations, sessionsByStationId],
  );

  return (
    <CollapsibleSection title={category.name} subtitle={formatCurrency(categoryTotal)}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {category.stations.map(station => (
          <StationCard
            key={station.id}
            category={category}
            station={station}
            sessions={sessionsByStationId.get(station.id) ?? []}
            customers={customers}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}
```

(`useMemo` and `formatCurrency` are both already imported at the top of this file.)

- [ ] **Step 6: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web
exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, open Daily Sales, and confirm: each category
section and the Cafe section show a chevron + name + subtotal; clicking a header
collapses that section (chevron rotates, subtotal stays visible, station
cards/Cafe card hide) without affecting any other section; clicking Cafe's inner
"Show orders" toggle after collapsing/re-expanding Cafe still works independently;
reloading the page shows every section expanded again.

Run (from `apps/web`): `pnpm dev`, open Daily Sales, and confirm the same
collapse/expand behavior for category sections (web has no Cafe section to check).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/ui/collapsible-section.tsx apps/web/src/components/ui/collapsible-section.tsx apps/desktop/src/components/views/DailySalesView.tsx apps/web/src/components/views/DailySalesView.tsx
git commit -m "feat(desktop,web): collapsible Daily Sales sections with a persistent subtotal"
```

---

## Final verification

- [ ] `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web
  exec tsc -b` — both clean.
- [ ] Any existing desktop e2e spec that locates elements inside a category or Cafe
  section by `data-testid` (`resource-card-...`, `cafe-summary-card`) or by session
  row (`session-row`) still passes — those test ids are unchanged, only the wrapping
  header markup around them changes. Any spec that locates a category/Cafe heading by
  role (`getByRole('heading', { name: ... })`) should also still pass, since `<h2>` is
  still rendered — just nested inside the new clickable header button.
- [ ] Manual check (`pnpm dev` on both apps): collapse/expand every section
  independently, confirm subtotals are correct and stay visible while collapsed, and
  confirm state resets to all-expanded on reload/navigation.
