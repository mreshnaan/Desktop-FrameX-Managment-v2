# Offers and discounts (foundation + promotional rules) — design

> Sub-project 8. New feature area, unrelated to sub-projects 6-7 (both merged to
> `dev`). First of three planned sub-projects covering offers/discounts:
> **(1) this one** — an extensible `Offer` foundation plus the promotional-rule case
> (day/time/duration/quantity-conditioned deals, like a "Weekday Special"),
> **(2) bundle offers** (table time + free/discounted cafe items — deferred, crosses
> into Order/cafe territory), **(3) customer-specific discounts** (deferred).

## Goal

Today, pricing is a single fixed rate per category (`Rate.hour/half/value`) with no
notion of day, time-of-day, or promotional conditions. Real-world pricing sheets (the
motivating example) mix several distinct mechanics — a standard rate, a "book 1.5hr,
get 30 min free" weekday deal, dual per-time/per-game pricing for one category, and
implicitly a "buy N games get one free" loyalty-style promo. Building one system that
tries to cover all of it at once would be a mess, so this sub-project scopes tightly:

**In scope:** an `Offer` entity — a named, togglable-on/off promotional rule scoped to
one category, with optional day-of-week / time-of-day / date-range / minimum-duration
/ minimum-game-count conditions, and one of three effects (extra free time, percent
off, flat amount off). A new admin-only Offers Management view to create/edit/toggle
them. On Daily Sales, when a session becomes eligible for an active offer, an inline
prompt lets the cashier apply it with one click — nothing is ever auto-applied
silently.

**Explicitly out of scope** (confirmed with the user, each a candidate follow-up):
- Bundle offers linking a session to cafe products (sub-project 9).
- Customer-specific discount rates (sub-project 10).
- Dual billing per category (e.g. Carrom being both time- and per-game-billed
  simultaneously) — today achievable with zero code changes by configuring two
  categories ("Carrom - Time", "Carrom - Game"); a true hybrid-billing category is a
  separate, smaller follow-up if ever needed.
- Enforcing/rejecting bookings outside a category's operating hours — the 1:30pm-6pm
  window in the motivating example reads as business hours / the rate card, not a
  discount condition, and isn't touched here.
- Aggregate "how much did we give away in discounts this month" reporting — v1 makes
  the discount visible per-session in Daily Sales (so it's auditable), but a rollup
  report is deferred.
- Repeating quantity offers (e.g. every 4th, 8th, 12th game free, indefinitely) — v1's
  `minGameCount` condition triggers exactly once, on the Nth session of the day (see
  "Frame-count offers" below); a repeating-cycle variant is a future nuance if needed.

## Data model: `Offer`

New entity, synced desktop (SQLite) ↔ Postgres like every other entity, following the
same 9-hop pipeline already used by `Rate`/`Customer` (SQLite migration → Rust model →
Rust commands → `sync.rs`'s `apply_offers` → Prisma model → `sync.service.ts` →
`sync.schema.ts` → desktop `commands.ts` wire type → a `useOffers.ts` hook).

Unlike `Rate` (exactly one row per category, upsert-only, no delete), an `Offer` is a
genuine list — a category can have zero, one, or several active offers at once (e.g.
Carrom could eventually have both a weekday time-discount and a game-count discount).
So `Offer` follows the `Session`/`Customer`-style list pattern instead: `id` PK,
create + update (via a nested-`Option` `OfferPatch` matching `SessionPatch`'s existing
convention) + an `active` boolean toggle. No true delete/soft-delete in v1 — retiring
an offer means switching `active` off, keeping the management list simple and every
action reversible (fewer irreversible-feeling actions to worry about, matching the
"less friction" ask). `updated_at`/`created_by`/`updated_by` follow the existing
audit-trail columns pattern.

Fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | `String` (PK) | |
| `categoryId` | `String` (FK) | One category per offer — no join table. Two offers on the same category is just two rows. |
| `name` | `String` | Shown in the management list and in the apply-prompt/session display, e.g. "Weekday Special". |
| `active` | `bool` | On/off toggle. Inactive offers never appear as eligible. |
| `days` | `String?` | Comma-separated weekday codes (`mon,tue,wed,thu,fri`); `null`/empty = every day. |
| `startTime`/`endTime` | `String?` (`"HH:MM"`) | Time-of-day window; `null` = any time. Compared against the session's own `start` if time-billed and non-empty, otherwise against the current wall-clock time at the moment of prompting (frame-billed sessions never populate `start`/`end` today). |
| `startDate`/`endDate` | `String?` (`"YYYY-MM-DD"`) | For limited-time promos; `null` on either end = unlimited/ongoing in that direction. Both bounds inclusive (`session.date >= startDate AND session.date <= endDate`), matching the date-range convention already used in the Rust reports queries. |
| `minDurationMinutes` | `i64?` | Time-billed condition: session's current duration must be ≥ this to be eligible (the "book 1.5hr" part of the Weekday Special). |
| `minGameCount` | `i64?` | Frame-billed condition: eligible exactly when this session is the customer's Nth session today in this category (see below) — `null` means this condition doesn't apply (most time-billed offers will leave this unset). |
| `effectType` | `String` (`'extraTime' \| 'percentOff' \| 'flatOff'`) | |
| `effectValue` | `i64` | Minutes (for `extraTime`), whole-number percent (for `percentOff`), or rupees (for `flatOff`). |
| `updatedAt`, `createdBy`, `updatedBy` | as elsewhere | |

An offer with every condition field `null` simply always matches (any day, any time,
no date limit, no minimum) — conditions are opt-in restrictions, not required fields.

## Applying an offer to a session

**Mechanism: system suggests, cashier confirms.** Nothing is ever applied
automatically. Eligibility is checked client-side in `DailySalesView.tsx` (all the
needed data — the session, its category, today's date's weekday, current wall-clock
time, and today's sibling sessions for count-based conditions — is already loaded
there via existing hooks; no new Rust "list eligible offers" endpoint is needed). When
a session matches an active offer's conditions and no offer is currently applied, a
small inline prompt appears on that session row (e.g. "🎉 Weekday Special available —
Apply?"). One click calls the same `updateSession` mutation already used for every
other session edit, with a patch setting `offerId`.

**Amount computation (Rust, `do_update_session`):** when a patch sets `offerId` to a
real value, the session's `amount` is always **recomputed from scratch** — the
category's rate × current duration (time-billed) or the frame rate (frame-billed) —
and then the offer's effect is applied on top, regardless of whether the cashier had
previously hand-edited the amount. This is a deliberate simplification: applying an
offer means "price this session correctly, with the discount," not "discount whatever
number happens to be in the box right now" — the latter would let a stale manual edit
and an offer stack unpredictably. The resulting discount (`base amount − final
amount`) is stored alongside the offer reference so it's visible and auditable:

- `Session.offerId: String?` — nested-`Option` on `SessionPatch` (`Option<Option<String>>`,
  same convention as `method`/`customerId`/`paidAt`) so a patch can explicitly clear
  it (`Some(None)`) to remove an applied offer, which recomputes `amount` back to the
  plain undiscounted base.
- `Session.discountAmount: i64?` — server-computed only, never client-supplied;
  `null` when no offer is applied.

Since `offerId` is a single nullable field (not a list), a session can never have more
than one offer applied at a time by construction — no stacking logic is needed.
Applying a second offer simply replaces the first (recomputing from the undiscounted
base again, then applying the new offer's effect).

Effect math:
- `extraTime`: billable duration = `max(0, actual_duration_minutes - effectValue)`,
  then `calc_time_amount` runs on that reduced duration. (Time-billed only —
  `min_duration_minutes` should be set on any `extraTime` offer so it can't trigger
  on a session shorter than the free time itself.)
- `percentOff`: `final = round(base * (100 - effectValue) / 100)`.
- `flatOff`: `final = max(0, base - effectValue)`.

`discountAmount = base - final` in all three cases.

## Frame-count offers ("buy 3 games, 4th free")

Counting is **per customer, per category, per day** — resets every day, matching how
Daily Sales already scopes everything by date. This means a customer must be selected
on a frame-billed session for a `minGameCount` offer on that category to ever become
eligible (Cash/Card sessions don't require a customer today; this is unchanged except
that the eligibility prompt simply won't appear until one is picked, for categories
where a quantity offer is actually active — no change for categories/shops that don't
use quantity offers).

Eligibility triggers **exactly once**, when the session being created/edited is the
customer's `minGameCount`-th session today in that category (i.e. `(today's prior
count for this customer+category) + 1 == minGameCount`) — not on every session
thereafter. A cashier creates games 1-3 normally; on game 4, the prompt appears once.
This is deliberately simple for v1 (see "Explicitly out of scope" above for the
repeating-cycle variant).

## Offers Management view

New view, `apps/desktop/src/components/views/OfferManagementView.tsx`, following
`RateManagementView.tsx`'s established conventions (react-hook-form + zod, `Field`/
`FieldError` primitives, autosave-on-blur where it makes sense) but as a genuine
create/list view (not upsert-by-category) since a category can have multiple offers:
a list of existing offers (grouped or filterable by category) each with an
active/inactive toggle and an edit form, plus a "+ New offer" action.

**Permission:** a new `offerManagement` permission key, added to `ADMIN_ONLY_PERMISSIONS`
in both `apps/desktop/src/lib/shared/constants/roles.ts` and
`apps/api/src/shared/constants/roles.ts` (kept manually in sync per their existing
convention) — Owner/Admin only, unlike Rate Management. Applying an already-configured
active offer during checkout is unaffected by this — that's part of `dailySales`
access, already available to Cashier.

## New shared utility

No `dayOfWeek(dateStr)` helper exists yet (`DateStepper.tsx` inlines
`WEEKDAYS[d.getDay()]`). Add one to `apps/desktop/src/lib/shared/utils/dates.ts`
(built on the existing `parseDate`), reused by both the offer-eligibility check and
the management form's day-picker.

## Testing

- Rust unit tests for the effect math (`extraTime`/`percentOff`/`flatOff` against
  known inputs) and for `do_update_session`'s offer-apply/offer-clear recompute paths,
  following the existing test style in `sessions.rs`.
- Rust unit tests for the frame-count eligibility trigger (exactly-once-at-N, not
  before, not after).
- `pnpm --filter @cue-room/desktop exec tsc -b` / `pnpm --filter @cue-room/web exec
  tsc -b`.
- `apps/api` integration tests covering the new sync table round-trip (push a
  session with an `offerId`/`discountAmount`, pull it back, confirm both survive) and
  the new `offerManagement` permission gate.
- Manual check (`pnpm dev`): create the exact motivating example (an 8-Ball Weekday
  Special offer: category 8-Ball, days Mon-Fri, `minDurationMinutes` 90, effect
  `extraTime` 30) in Offers Management as Owner; log in as Cashier, start a session,
  set start/end to 1h30m on a weekday, confirm the "Apply?" prompt appears and the
  amount drops by the 30-minutes-free amount on click; confirm clearing the offer
  restores the undiscounted amount.
