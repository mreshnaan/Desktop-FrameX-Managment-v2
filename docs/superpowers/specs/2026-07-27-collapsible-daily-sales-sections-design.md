# Collapsible Daily Sales sections — design

> Sub-project 7 of the codebase-cleanup refactor. Raised mid-session as a new,
> independent feature while sub-project 6 (Session pending payment + customer
> picker, branch `feature/session-paid-status`) was executing in the background.
> Unrelated to sub-project 6's data model changes — this is a pure UI change to
> `DailySalesView.tsx` in both apps.

## Goal

Daily Sales renders one section per category (e.g. 8-Ball, Snooker, PlayStation —
categories are admin-configured via Category Management, not a fixed list, so a shop
could add others like Carrom) plus, on desktop only, a Cafe section. Every section is
always fully expanded today, so a shop with several categories and a busy cafe means a
lot of scrolling to find the one section a cashier actually needs. The fix: each
section gets a clickable header that collapses/expands its contents, independently of
every other section.

## Behavior

- Each category section (`CategoryGroup` in `DailySalesView.tsx`, both apps) and
  desktop's Cafe section (`CafeSection`) get a clickable header row: a chevron icon,
  the section name, and a running subtotal for that section — e.g. "▸ 8-Ball ₹400" —
  replacing today's plain `<h2>{category.name}</h2>` (or `<h2>Cafe</h2>`).
- Clicking anywhere on the header toggles that section's body (the station-cards grid
  for a category; the summary+orders `<Card>` for Cafe) between hidden and visible.
  The subtotal stays visible in the header in both states — collapsing only hides the
  detail underneath, never the number.
- Every section starts expanded on every page load/navigation. No persistence
  (`localStorage` or otherwise) — this is deliberately simple, matching the "always
  start expanded" decision: collapsing is a same-visit convenience, not a saved
  preference.
- Each section's collapsed/expanded state is independent local component state —
  collapsing 8-Ball has no effect on Snooker, PlayStation, or Cafe.
- Desktop's Cafe section already has its own inner "Show orders / Hide orders" toggle
  that shows/hides just the order list within the Cafe summary card. That toggle is
  untouched — the new section-level collapse is a separate, outer control that hides
  the entire Cafe card (summary numbers and order list together), the same as
  collapsing hides an entire category's station cards.
- Web's Daily Sales view has no Cafe section at all (confirmed — web's
  `DailySalesView.tsx` has no cafe/order code path); this feature only adds
  collapsible category sections there, not a collapsible Cafe section.

## Component

A new shared-per-app UI primitive, following this codebase's established pattern of
small UI shells duplicated per app rather than pulled into a cross-app package (the
same pattern `DataTable` used in an earlier sub-project):

- `apps/desktop/src/components/ui/collapsible-section.tsx`
- `apps/web/src/components/ui/collapsible-section.tsx`

```tsx
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
          <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed && '-rotate-90')} />
          <h2 className="text-lg font-semibold">{title}</h2>
        </span>
        {subtitle && <span className="text-sm font-medium text-muted-foreground">{subtitle}</span>}
      </button>
      {!collapsed && children}
    </section>
  );
}
```

**Wiring:**
- `CategoryGroup` (both apps): computes a per-category subtotal from
  `sessionsByStationId` (sum of `.amount` across every station belonging to that
  category — the same values already summed per-station in `StationCard`, just
  rolled up one level), and wraps its existing station-cards grid in
  `<CollapsibleSection title={category.name} subtitle={formatCurrency(categoryTotal)}>`.
- Desktop's `CafeSection`: wraps its existing summary `<Card>` in
  `<CollapsibleSection title="Cafe" subtitle={formatCurrency(revenue)}>` (`revenue` is
  already computed and passed into `CafeSection` today). The inner "Show orders / Hide
  orders" button and its state are untouched, nested unchanged inside the new outer
  wrapper.
- Both apps' outer `<section className="flex flex-col gap-3">` wrapper (currently
  written directly in `CategoryGroup`/`CafeSection`) moves into `CollapsibleSection`
  itself, so call sites stop duplicating it.

## Testing

No data-layer change — this is pure client-side UI state. Verification is:

- `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web exec
  tsc -b`.
- Manual check (`pnpm dev` on both apps): collapse/expand each category section and
  (desktop only) the Cafe section independently; confirm the subtotal is correct and
  stays visible while collapsed; confirm collapsing one section doesn't affect
  others; confirm collapsing Cafe doesn't reset or interfere with its inner "Show
  orders" toggle state; confirm every section is expanded again after a page
  reload/navigation.
- Any existing desktop e2e spec that locates elements inside a category or Cafe
  section by role/text (e.g. `data-testid="resource-card-..."`,
  `data-testid="cafe-summary-card"`) still passes, since those test ids are
  unchanged — only the wrapping header markup around them changes.
