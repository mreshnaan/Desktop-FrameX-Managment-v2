# Cue Room — Pool Table Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Cue Room", a pool-hall front-desk app (daily/monthly sales, customer credit, expenses, rate management) as a **local-first** app that runs identically as a **Tauri desktop app** and a **website**, with **bidirectional sync** against a **self-hosted API**, gated by **role-based access** (Owner, Admin/Super Admin, Cashier).

**Architecture:** A pnpm monorepo with four independently-testable subsystems, built in order:
- **Part A — Frontend app** (React + TypeScript + Vite, shadcn/ui on Tailwind, react-hook-form+zod, TanStack Table/Query): the full Cue Room UI reading/writing a local Dexie (IndexedDB) database. Fully functional offline, on one device, before any backend exists. Same build is wrapped by Tauri for desktop, shipped as-is for web, and independently Docker-buildable as a static site (Task 12).
- **Part B — Backend API** (Node/TypeScript, Express, Prisma, PostgreSQL, JWT auth, RBAC middleware): standalone, testable with no frontend — auth, per-role authorization, generic push/pull sync endpoints, and an independent standalone Docker build (Task 18).
- **Part C — Sync wiring**: an outbox-based sync engine in the frontend that drains local mutations to the API and pulls remote changes into Dexie, plus the login screen and role-gated navigation.
- **Part D — End-to-end tests** (Playwright): drives the real rendered app against the real API + Postgres, covering the view-composition work Part A's unit tests deliberately don't (per Global Constraints), plus the sync engine's offline/two-device behavior.

`packages/shared` (zod schemas, constants, money/date math) is consumed by both Part A and Part B during development via pnpm's `workspace:*`, but is compiled to `dist/` and physically copied into each app's production build — see "Hosting & independent deployability" below for why this doesn't couple `apps/api`'s or `apps/web`'s deploys to the rest of the monorepo.

**Tech Stack:** React 18, TypeScript, Vite, Tauri 2, Tailwind CSS, shadcn/ui, react-hook-form, zod, @hookform/resolvers, @tanstack/react-table, @tanstack/react-query, Dexie.js, Express, Prisma, PostgreSQL, jsonwebtoken, bcrypt, Vitest (unit tests, all three packages), Playwright (e2e), Docker, pnpm workspaces.

## Global Constraints

- **Monorepo:** pnpm workspaces. Package manager is `pnpm` throughout (already implies workspace-aware installs) — do not mix in npm/yarn commands.
- **Language:** TypeScript everywhere (frontend, backend, shared package). No `any` in new code; prefer zod-inferred types over hand-written duplicate interfaces.
- **Validation source of truth:** every mutable entity (Session, Expense, Customer, CreditEntry, Rate, User/Auth) has exactly one zod schema in `packages/shared`, imported by both the API (server-side validation) and the web app (react-hook-form resolvers). Never redefine the same shape twice.
- **Domain source of truth:** `CATEGORIES`, `DEFAULT_RATES`, `WEEKDAYS`, `MONTHS`, and the `ROLE_PERMISSIONS` matrix live once in `packages/shared` — copied verbatim from the original design spec (categories/rates) and from the answered requirements (roles), below.
- **Money math:** amounts are stored as integers (smallest currency unit is not sub-divided here — the original spec rounds to whole numbers with `Math.round`); currency symbol is `₹`, hardcoded (matches the spec's default, no settings UI).
- **Soft deletes:** every syncable table whose rows the UI can actually delete (Session, Expense, Customer) has `updatedAt` and `deletedAt` columns, both locally (Dexie) and remotely (Postgres) — hard deletes are never used there, because sync needs tombstones to propagate deletions. `CreditEntry` (an append-only ledger — no task gives the UI a way to delete a credit/payment entry) and `Rate` (one row per fixed category, always upserted, never removed) only need `updatedAt`; do not add `deletedAt` to those two — it would be a dead column with no code path that ever sets it.
- **Conflict strategy:** last-write-wins by server-assigned `updatedAt`. The server is always the authority on `updatedAt` (it stamps `now()` on every write) — clients never set it. This is a deliberate simplification (no CRDT) appropriate for a single business's low-concurrency records, not concurrent rich-text editing.
- **Role matrix (from requirements):** `OWNER` and `ADMIN` (super admin) have full access to every view **and** user management. `CASHIER` has full access to every business view (Daily Sales, Monthly Sales, Customers, Credit Management, Expenses, Rate Management) but **not** User Management.
- **UI testing scope:** pure logic (money math, date math, RBAC checks, sync merge logic) gets real unit tests per the steps below. View-composition components (JSX layout wiring shadcn primitives together) are not separately unit-tested — that coverage lives in Part D's Playwright end-to-end tests instead, which exercise the actual rendered app against a real API + Postgres, closer to how the app is really used than a component snapshot would be.
- **Independent deployability:** `apps/api`, `apps/web`, and `packages/shared` must each be buildable and shippable on their own — no app's production deploy may depend on having the whole monorepo present at runtime. `packages/shared` is consumed as source (`workspace:*`) during development for DRY, but is compiled to `dist/` and each app's build step bundles/copies its own resolved copy. See "Hosting & independent deployability" below.
- **No placeholders:** every task below either ships working code or is explicitly marked as a manual verification step.

---

## Hosting & independent deployability

`packages/shared` exists so the zod schemas, constants, and money/date math are defined exactly once and used identically by both the API and the frontend — the alternative is hand-duplicating every schema in two places, which is the DRY violation the rest of this plan is explicitly trying to avoid. It does not make any of the three pieces harder to host, as long as each is *built* rather than shipped as raw TypeScript source:

- **`packages/shared` compiles to `dist/`** (plain `tsc`, no bundler needed — it's just types + small pure functions). Its `package.json` points `main`/`types` at `dist/index.js`/`dist/index.d.ts`, not `src/`.
- **`apps/api` ships as a Docker image**, built from the *monorepo root* so pnpm can resolve the `workspace:*` reference and compile `packages/shared` first: `COPY` the whole repo into a build stage, `pnpm install --frozen-lockfile`, `pnpm --filter @cue-room/shared build && pnpm --filter @cue-room/api build`, then a slim final stage copies only `apps/api/dist`, `apps/api/node_modules` (pruned via `pnpm --filter @cue-room/api deploy /out --prod`, which materializes a self-contained folder with `@cue-room/shared`'s compiled files physically copied in, not symlinked) and the Prisma client. The resulting image has zero monorepo dependency at runtime — it is exactly as easy to self-host on a VPS/Railway/Fly/Render as a single-package Express app would be, because after this build step it *is* one.
- **`apps/web` ships as a static site** (Vite's `dist/`, produced the same way — `packages/shared` built first, then `apps/web` built against it) — deployable to any static host (or served by the same reverse proxy as the API, or bundled into the Tauri binary for desktop). No server runtime, no monorepo coupling at all once built.
- Task 13 and Task 4 are amended to add each app's Dockerfile / build script producing these standalone artifacts (see Task 18 and Task 12 below).

---

# Repo layout (created in Task 1)

```
pool-managemnt/
  package.json                     # pnpm workspace root, shared scripts
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/
    shared/
      package.json
      src/
        constants/
          categories.ts            # CATEGORIES, DEFAULT_RATES, WEEKDAYS, MONTHS
          roles.ts                 # ROLES, ROLE_PERMISSIONS, hasAccess()
        schemas/
          session.schema.ts
          expense.schema.ts
          customer.schema.ts
          creditEntry.schema.ts
          rate.schema.ts
          auth.schema.ts
          sync.schema.ts
        utils/
          dates.ts                 # pad, todayStr, parseDate, dateStrOf, durationMinutes
          money.ts                 # calcTimeAmount, calcFrameAmount, calcCustomerBalance, formatCurrency
        index.ts                   # barrel export
        tests/
          money.test.ts
          dates.test.ts
          roles.test.ts
  apps/
    api/
      package.json
      Dockerfile                   # standalone image via `pnpm deploy` (Task 18)
      .dockerignore
      prisma/schema.prisma
      src/
        server.ts
        env.ts
        db.ts
        lib/jwt.ts
        lib/password.ts
        middleware/auth.ts
        middleware/requireRole.ts
        middleware/errorHandler.ts
        routes/auth.routes.ts
        routes/users.routes.ts
        routes/sync.routes.ts
        services/auth.service.ts
        services/sync.service.ts
        tests/
          jwt.test.ts
          requireRole.test.ts
          auth.service.test.ts
          sync.service.test.ts
    web/
      package.json
      Dockerfile                   # standalone static build via nginx (Task 12)
      nginx.conf
      vite.config.ts
      tailwind.config.ts
      index.html
      src-tauri/                   # Tauri desktop shell (Task 11)
        Cargo.toml
        tauri.conf.json
        src/main.rs
      src/
        main.tsx
        App.tsx
        styles/globals.css
        lib/
          db/dexie.ts
          sync/outbox.ts
          sync/syncEngine.ts
          api/client.ts
          auth/AuthContext.tsx
          auth/useAuth.ts
          hooks/useSessions.ts
          hooks/useExpenses.ts
          hooks/useCustomers.ts
          hooks/useRates.ts
        components/
          ui/                      # shadcn-generated primitives
          layout/Sidebar.tsx
          layout/AppShell.tsx
          views/DailySalesView.tsx
          views/MonthlySalesView.tsx
          views/CustomersView.tsx
          views/CreditManagementView.tsx
          views/ExpensesView.tsx
          views/RateManagementView.tsx
          views/UserManagementView.tsx
          auth/LoginForm.tsx
        tests/
          dexie.outbox.test.ts
          useSessions.test.tsx
    e2e/
      package.json
      playwright.config.ts
      fixtures/seed.ts
      tests/
        daily-sales.spec.ts
        credit-flow.spec.ts
        rbac.spec.ts
        sync.spec.ts
```

---

# PART A — Frontend app (local-only, offline-capable, no backend yet)

### Task 1: Monorepo scaffold

**Files:**
- Create: `pool-managemnt/package.json`, `pool-managemnt/pnpm-workspace.yaml`, `pool-managemnt/tsconfig.base.json`

- [ ] **Step 1: Create the workspace root**

`pool-managemnt/package.json`:
```json
{
  "name": "cue-room",
  "private": true,
  "scripts": {
    "dev:web": "pnpm --filter @cue-room/web dev",
    "dev:api": "pnpm --filter @cue-room/api dev",
    "build:web": "pnpm --filter @cue-room/web build",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

`pool-managemnt/pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`pool-managemnt/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 2: Run `pnpm install` at the repo root**

Run: `pnpm install`
Expected: lockfile created, no errors (no packages yet besides the root devDependency).

- [ ] **Step 3: Commit**

```bash
git init
git add package.json pnpm-workspace.yaml tsconfig.base.json
git commit -m "chore: scaffold pnpm monorepo"
```

---

### Task 2: `packages/shared` — constants, and money/date utils with tests

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/constants/categories.ts`
- Create: `packages/shared/src/constants/roles.ts`
- Create: `packages/shared/src/utils/dates.ts`
- Create: `packages/shared/src/utils/money.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/tests/dates.test.ts`, `packages/shared/src/tests/money.test.ts`, `packages/shared/src/tests/roles.test.ts`

**Interfaces:**
- Produces: `CATEGORIES`, `DEFAULT_RATES`, `WEEKDAYS`, `MONTHS`, `Category` type — imported by both apps for the fixed table/rate structure.
- Produces: `ROLES`, `Role` type, `ROLE_PERMISSIONS`, `hasAccess(role: Role, view: ViewKey): boolean` — imported by the API's `requireRole` middleware and the web app's sidebar/route gating.
- Produces: `pad, todayStr, parseDate, dateStrOf, durationMinutes` — date helpers used by both the web app's Daily/Monthly views and the API's sync-window queries.
- Produces: `calcTimeAmount(start: string, end: string, rate: {hour:number; half:number}): number`, `calcFrameAmount(rate: number): number`, `calcCustomerBalance(sessions: {method:string; customerId:string; amount:number}[], history: {customerId:string; type:'CREDIT_GIVEN'|'PAYMENT_RECEIVED'; amount:number}[], customerId: string): number`, `formatCurrency(n: number): string`.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/tests/dates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pad, parseDate, dateStrOf, durationMinutes } from '../utils/dates';

describe('dates', () => {
  it('pads single digits', () => {
    expect(pad(3)).toBe('03');
    expect(pad(12)).toBe('12');
  });

  it('round-trips a date string', () => {
    const d = parseDate('2026-07-23');
    expect(dateStrOf(d)).toBe('2026-07-23');
  });

  it('computes duration across the hour', () => {
    expect(durationMinutes('09:15', '10:45')).toBe(90);
  });

  it('wraps past midnight', () => {
    expect(durationMinutes('23:30', '00:30')).toBe(60);
  });

  it('returns 0 for missing times', () => {
    expect(durationMinutes('', '10:00')).toBe(0);
    expect(durationMinutes('09:00', '')).toBe(0);
  });
});
```

`packages/shared/src/tests/money.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { calcTimeAmount, calcFrameAmount, calcCustomerBalance, formatCurrency } from '../utils/money';

describe('calcTimeAmount', () => {
  it('charges only the hourly rate for exact hours', () => {
    expect(calcTimeAmount('09:00', '11:00', { hour: 200, half: 100 })).toBe(400);
  });

  it('adds the half-hour rate for a 30-minute remainder', () => {
    expect(calcTimeAmount('09:00', '10:30', { hour: 200, half: 100 })).toBe(300);
  });

  it('prorates an odd remainder off the hourly rate when half rate is 0', () => {
    expect(calcTimeAmount('09:00', '09:45', { hour: 200, half: 0 })).toBe(150);
  });
});

describe('calcFrameAmount', () => {
  it('seeds the amount from the per-frame rate', () => {
    expect(calcFrameAmount(150)).toBe(150);
  });
});

describe('calcCustomerBalance', () => {
  const sessions = [
    { method: 'Credit', customerId: 'c1', amount: 300 },
    { method: 'Cash', customerId: 'c1', amount: 100 },
    { method: 'Credit', customerId: 'c2', amount: 999 },
  ];
  const history = [
    { customerId: 'c1', type: 'CREDIT_GIVEN' as const, amount: 100 },
    { customerId: 'c1', type: 'PAYMENT_RECEIVED' as const, amount: 150 },
  ];

  it('sums credit sessions + manual credit − manual payments, for one customer only', () => {
    expect(calcCustomerBalance(sessions, history, 'c1')).toBe(300 + 100 - 150);
  });
});

describe('formatCurrency', () => {
  it('prefixes the rupee symbol and groups thousands', () => {
    expect(formatCurrency(12345)).toBe('₹12,345');
  });
  it('treats non-numeric input as 0', () => {
    expect(formatCurrency(NaN)).toBe('₹0');
  });
});
```

`packages/shared/src/tests/roles.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hasAccess } from '../constants/roles';

describe('hasAccess', () => {
  it('grants owner and admin every view including user management', () => {
    expect(hasAccess('OWNER', 'userManagement')).toBe(true);
    expect(hasAccess('ADMIN', 'userManagement')).toBe(true);
    expect(hasAccess('OWNER', 'rateManagement')).toBe(true);
  });

  it('grants cashier every business view but not user management', () => {
    expect(hasAccess('CASHIER', 'dailySales')).toBe(true);
    expect(hasAccess('CASHIER', 'rateManagement')).toBe(true);
    expect(hasAccess('CASHIER', 'creditManagement')).toBe(true);
    expect(hasAccess('CASHIER', 'userManagement')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cue-room/shared test`
Expected: FAIL — modules under `../utils/dates`, `../utils/money`, `../constants/roles` don't exist yet.

- [ ] **Step 3: Implement `packages/shared/package.json`**

```json
{
  "name": "@cue-room/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.6.0" }
}
```
`main`/`types` point at `dist/` (not `src/`) precisely so `apps/api` and `apps/web` each depend on a *compiled* artifact of this package, not its raw TypeScript source — this is what makes each app independently buildable/shippable (see "Hosting & independent deployability" above). During local development, `pnpm --filter @cue-room/shared build --watch` (added once the package exists) keeps `dist/` fresh; production builds always run the shared build first, then the consuming app's build.

- [ ] **Step 4: Implement `packages/shared/src/constants/categories.ts`**

```ts
export type Billing = 'time' | 'frame';

export interface Category {
  name: string;
  resources: string[];
  billing: Billing;
}

export const CATEGORIES: Category[] = [
  { name: '8-Ball', resources: ['Table 1', 'Table 2', 'Table 3'], billing: 'time' },
  { name: 'Snooker', resources: ['Table 1'], billing: 'frame' },
  { name: 'PlayStation', resources: ['Station 1', 'Station 2'], billing: 'time' },
];

export type TimeRate = { hour: number; half: number };

export const DEFAULT_RATES: Record<string, TimeRate | number> = {
  '8-Ball': { hour: 200, half: 100 },
  Snooker: 150,
  PlayStation: { hour: 100, half: 50 },
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
```

- [ ] **Step 5: Implement `packages/shared/src/constants/roles.ts`**

```ts
export const ROLES = ['OWNER', 'ADMIN', 'CASHIER'] as const;
export type Role = (typeof ROLES)[number];

export type ViewKey =
  | 'dailySales'
  | 'monthlySales'
  | 'customers'
  | 'creditManagement'
  | 'expenses'
  | 'rateManagement'
  | 'userManagement';

const BUSINESS_VIEWS: ViewKey[] = [
  'dailySales', 'monthlySales', 'customers', 'creditManagement', 'expenses', 'rateManagement',
];

export const ROLE_PERMISSIONS: Record<Role, ViewKey[]> = {
  OWNER: [...BUSINESS_VIEWS, 'userManagement'],
  ADMIN: [...BUSINESS_VIEWS, 'userManagement'],
  CASHIER: [...BUSINESS_VIEWS],
};

export function hasAccess(role: Role, view: ViewKey): boolean {
  return ROLE_PERMISSIONS[role].includes(view);
}
```

- [ ] **Step 6: Implement `packages/shared/src/utils/dates.ts`**

```ts
export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dateStrOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function durationMinutes(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}
```

- [ ] **Step 7: Implement `packages/shared/src/utils/money.ts`**

```ts
import type { TimeRate } from '../constants/categories';
import { durationMinutes } from './dates';

export function calcTimeAmount(start: string, end: string, rate: TimeRate): number {
  const mins = durationMinutes(start, end);
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  let amt = hours * rate.hour;
  if (rem > 0) {
    amt += rate.half > 0 ? rate.half * (rem / 30) : rate.hour * (rem / 60);
  }
  return Math.round(amt);
}

export function calcFrameAmount(rate: number): number {
  return Math.round(rate);
}

export interface BalanceSession { method: string; customerId: string | null; amount: number }
export interface BalanceHistoryEntry { customerId: string; type: 'CREDIT_GIVEN' | 'PAYMENT_RECEIVED'; amount: number }

export function calcCustomerBalance(
  sessions: BalanceSession[],
  history: BalanceHistoryEntry[],
  customerId: string
): number {
  const sessionCredit = sessions
    .filter(s => s.method === 'Credit' && s.customerId === customerId)
    .reduce((a, s) => a + s.amount, 0);
  const given = history
    .filter(h => h.customerId === customerId && h.type === 'CREDIT_GIVEN')
    .reduce((a, h) => a + h.amount, 0);
  const paid = history
    .filter(h => h.customerId === customerId && h.type === 'PAYMENT_RECEIVED')
    .reduce((a, h) => a + h.amount, 0);
  return sessionCredit + given - paid;
}

export function formatCurrency(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return '₹' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
```

- [ ] **Step 8: Implement the barrel export `packages/shared/src/index.ts`**

```ts
export * from './constants/categories';
export * from './constants/roles';
export * from './utils/dates';
export * from './utils/money';
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm --filter @cue-room/shared test`
Expected: PASS — all suites in `dates.test.ts`, `money.test.ts`, `roles.test.ts` green.

- [ ] **Step 10: Add `packages/shared/tsconfig.json` and verify the compiled build both apps will depend on**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["src/tests"]
}
```

Run: `pnpm --filter @cue-room/shared build`
Expected: `packages/shared/dist/index.js` and `dist/index.d.ts` exist — this is the artifact `apps/api` and `apps/web` will each depend on (per "Independent deployability" in Global Constraints), not the raw `src/`.

Add `packages/shared/.gitignore` containing `dist`.

- [ ] **Step 11: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): categories/roles constants and date/money utils"
```

---

### Task 3: `packages/shared` — zod schemas for every entity

**Files:**
- Create: `packages/shared/src/schemas/session.schema.ts`, `expense.schema.ts`, `customer.schema.ts`, `creditEntry.schema.ts`, `rate.schema.ts`, `auth.schema.ts`, `sync.schema.ts`
- Modify: `packages/shared/src/index.ts` (add schema exports)

**Interfaces:**
- Consumes: `CATEGORIES` (from Task 2) to validate `category`/`resource` pairs.
- Produces: `SessionSchema`, `Session` type; `ExpenseSchema`, `Expense`; `CustomerSchema`, `Customer`; `CreditEntrySchema`, `CreditEntry`; `RateSchema`, `Rate`; `LoginSchema`, `LoginInput`; `SyncPushSchema`, `SyncPushInput`. All consumed later by react-hook-form resolvers (Part A views) and by API route validation (Part B).

- [ ] **Step 1: Implement `packages/shared/src/schemas/session.schema.ts`**

```ts
import { z } from 'zod';
import { CATEGORIES } from '../constants/categories';

const categoryNames = CATEGORIES.map(c => c.name) as [string, ...string[]];

export const SessionSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(categoryNames),
  resource: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')),
  end: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')),
  amount: z.coerce.number().min(0),
  method: z.enum(['Cash', 'Card', 'Credit']),
  customerId: z.string().uuid().nullable(),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
}).refine(
  data => data.method !== 'Credit' || !!data.customerId,
  { message: 'A customer must be selected for Credit sessions', path: ['customerId'] }
);

export type Session = z.infer<typeof SessionSchema>;

export const SessionDraftSchema = SessionSchema.omit({ id: true, updatedAt: true, deletedAt: true });
export type SessionDraft = z.infer<typeof SessionDraftSchema>;
```

- [ ] **Step 2: Implement `packages/shared/src/schemas/expense.schema.ts`**

```ts
import { z } from 'zod';

export const ExpenseSchema = z.object({
  id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  method: z.enum(['Cash', 'Card']),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Expense = z.infer<typeof ExpenseSchema>;
export const ExpenseDraftSchema = ExpenseSchema.omit({ id: true, updatedAt: true, deletedAt: true });
export type ExpenseDraft = z.infer<typeof ExpenseDraftSchema>;
```

- [ ] **Step 3: Implement `packages/shared/src/schemas/customer.schema.ts`**

```ts
import { z } from 'zod';

export const CustomerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  phone: z.string().optional().default(''),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Customer = z.infer<typeof CustomerSchema>;
export const CustomerDraftSchema = CustomerSchema.omit({ id: true, updatedAt: true, deletedAt: true });
export type CustomerDraft = z.infer<typeof CustomerDraftSchema>;
```

- [ ] **Step 4: Implement `packages/shared/src/schemas/creditEntry.schema.ts`**

```ts
import { z } from 'zod';

export const CreditEntrySchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(['CREDIT_GIVEN', 'PAYMENT_RECEIVED']),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  updatedAt: z.string().datetime().optional(),
});
export type CreditEntry = z.infer<typeof CreditEntrySchema>;

export const CreditDraftSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0'),
});
export type CreditDraft = z.infer<typeof CreditDraftSchema>;
```

- [ ] **Step 5: Implement `packages/shared/src/schemas/rate.schema.ts`**

```ts
import { z } from 'zod';

export const TimeRateSchema = z.object({
  category: z.string(),
  hour: z.coerce.number().min(0),
  half: z.coerce.number().min(0),
});
export const FrameRateSchema = z.object({
  category: z.string(),
  value: z.coerce.number().min(0),
});
export type TimeRateInput = z.infer<typeof TimeRateSchema>;
export type FrameRateInput = z.infer<typeof FrameRateSchema>;
```

- [ ] **Step 6: Implement `packages/shared/src/schemas/auth.schema.ts`**

```ts
import { z } from 'zod';
import { ROLES } from '../constants/roles';

export const LoginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(ROLES as unknown as [string, ...string[]]),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
```

- [ ] **Step 7: Implement `packages/shared/src/schemas/sync.schema.ts`**

```ts
import { z } from 'zod';

export const SyncTableName = z.enum(['sessions', 'expenses', 'customers', 'creditEntries', 'rates']);

export const OutboxEntrySchema = z.object({
  table: SyncTableName,
  op: z.enum(['upsert', 'delete']),
  id: z.string().uuid(),
  payload: z.record(z.any()),
  clientUpdatedAt: z.string().datetime(),
});
export type OutboxEntry = z.infer<typeof OutboxEntrySchema>;

export const SyncPushSchema = z.object({ entries: z.array(OutboxEntrySchema).max(500) });
export type SyncPushInput = z.infer<typeof SyncPushSchema>;

export const SyncPullQuerySchema = z.object({ since: z.string().datetime().optional() });
export type SyncPullQuery = z.infer<typeof SyncPullQuerySchema>;
```

- [ ] **Step 8: Add schema exports to the barrel**

Modify `packages/shared/src/index.ts`, append:
```ts
export * from './schemas/session.schema';
export * from './schemas/expense.schema';
export * from './schemas/customer.schema';
export * from './schemas/creditEntry.schema';
export * from './schemas/rate.schema';
export * from './schemas/auth.schema';
export * from './schemas/sync.schema';
```

- [ ] **Step 9: Verify the package type-checks**

Run: `pnpm --filter @cue-room/shared exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): zod schemas for every entity, shared by api and web"
```

---

### Task 4: `apps/web` scaffold — Vite + React + TS + Tailwind + shadcn/ui

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.js`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles/globals.css`

- [ ] **Step 1: Scaffold via Vite's React-TS template, then layer Tailwind + shadcn**

Run (from `apps/web` after creating the directory):
```bash
pnpm create vite@latest . -- --template react-ts
pnpm add -D tailwindcss postcss autoprefixer @types/node
pnpm dlx tailwindcss init -p
pnpm dlx shadcn@latest init -d
```
`shadcn init -d` accepts the tool's defaults (New York style, CSS variables, `src/components/ui`, `src/lib/utils.ts`); we override the actual color/typography tokens in Step 3 below to match the "Classical" design system instead of shadcn's stock neutral theme.

- [ ] **Step 2: Set `apps/web/package.json` name and add workspace dependency on shared**

Edit the generated `package.json`: set `"name": "@cue-room/web"`, add:
```json
"dependencies": {
  "@cue-room/shared": "workspace:*"
}
```

- [ ] **Step 3: Map the Classical design system tokens onto shadcn's CSS variables**

Replace the color/font block of `apps/web/src/styles/globals.css` (the file `shadcn init` generated) with:
```css
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Lora:wght@400;600&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 95%;          /* #f3f2f2 */
    --foreground: 30 4% 12%;         /* #201f1d */
    --card: 0 0% 95%;
    --card-foreground: 30 4% 12%;
    --primary: 34 51% 47%;           /* #b68235 accent */
    --primary-foreground: 0 0% 100%;
    --border: 30 4% 12% / 0.16;      /* hairline divider */
    --input: 30 4% 12% / 0.16;
    --ring: 34 51% 47%;
    --radius: 0.25rem;               /* --radius-md: 4px */
    --font-heading: "Cormorant Garamond", system-ui, sans-serif;
    --font-body: "Lora", system-ui, sans-serif;
  }
  body { @apply bg-background text-foreground; font-family: var(--font-body); }
  h1, h2, h3, h4 { font-family: var(--font-heading); font-weight: 600; }
}
```
This keeps shadcn's component variants (`Button`, `Card`, `Input`, `Table`, `Select`, `Dialog`) but repaints them with the warm off-white ground, gold accent, hairline borders and serif headings from the imported design system, instead of shadcn's default look.

- [ ] **Step 4: Install the shadcn primitives this app needs**

Run:
```bash
pnpm dlx shadcn@latest add button card input select table dialog form label badge separator sidebar
```

- [ ] **Step 5: Verify the dev server boots**

Run: `pnpm --filter @cue-room/web dev`
Expected: Vite dev server starts, default template page renders with the Classical fonts/colors visible (not shadcn's default slate theme).

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "chore(web): scaffold vite+react+ts+tailwind+shadcn, theme with Classical tokens"
```

---

### Task 5: Dexie local database + outbox table

**Files:**
- Create: `apps/web/src/lib/db/dexie.ts`
- Test: `apps/web/src/tests/dexie.outbox.test.ts`

**Interfaces:**
- Consumes: `Session, Expense, Customer, CreditEntry` types (Task 3).
- Produces: `db` (Dexie instance) with tables `sessions, expenses, customers, creditEntries, rates, outbox`; `enqueueOutbox(table, op, id, payload)` helper used by every mutation hook in Task 6+ and by the sync engine in Part C.

- [ ] **Step 1: Write the failing test**

`apps/web/src/tests/dexie.outbox.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, enqueueOutbox } from '../lib/db/dexie';

describe('dexie outbox', () => {
  beforeEach(async () => { await db.outbox.clear(); await db.customers.clear(); });

  it('records a pending mutation alongside the local write', async () => {
    const id = crypto.randomUUID();
    await db.customers.put({ id, name: 'Ravi', phone: '', updatedAt: new Date().toISOString(), deletedAt: null });
    await enqueueOutbox('customers', 'upsert', id, { id, name: 'Ravi' });

    const pending = await db.outbox.toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ table: 'customers', op: 'upsert', id });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cue-room/web add -D fake-indexeddb && pnpm --filter @cue-room/web test dexie.outbox`
Expected: FAIL — `../lib/db/dexie` doesn't exist.

- [ ] **Step 3: Implement `apps/web/src/lib/db/dexie.ts`**

```ts
import Dexie, { type Table } from 'dexie';
import type { Session } from '@cue-room/shared';
import type { Expense } from '@cue-room/shared';
import type { Customer } from '@cue-room/shared';
import type { CreditEntry } from '@cue-room/shared';

export interface RateRow {
  category: string;
  hour: number | null;
  half: number | null;
  value: number | null;
  updatedAt: string;
}

export interface OutboxRow {
  outboxId?: number;
  table: 'sessions' | 'expenses' | 'customers' | 'creditEntries' | 'rates';
  op: 'upsert' | 'delete';
  id: string;
  payload: Record<string, unknown>;
  clientUpdatedAt: string;
}

export class CueRoomDB extends Dexie {
  sessions!: Table<Session, string>;
  expenses!: Table<Expense, string>;
  customers!: Table<Customer, string>;
  creditEntries!: Table<CreditEntry, string>;
  rates!: Table<RateRow, string>;
  outbox!: Table<OutboxRow, number>;

  constructor() {
    super('cue-room');
    this.version(1).stores({
      sessions: 'id, date, category, resource, customerId, updatedAt',
      expenses: 'id, date, updatedAt',
      customers: 'id, name, updatedAt',
      creditEntries: 'id, customerId, date, updatedAt',
      rates: 'category, updatedAt',
      outbox: '++outboxId, table, id',
    });
  }
}

export const db = new CueRoomDB();

export async function enqueueOutbox(
  table: OutboxRow['table'],
  op: OutboxRow['op'],
  id: string,
  payload: Record<string, unknown>
): Promise<void> {
  await db.outbox.add({ table, op, id, payload, clientUpdatedAt: new Date().toISOString() });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cue-room/web test dexie.outbox`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/db apps/web/src/tests/dexie.outbox.test.ts apps/web/package.json
git commit -m "feat(web): dexie local db with outbox table for offline sync"
```

---

### Task 6: Data hooks (`useSessions`, `useExpenses`, `useCustomers`, `useRates`) on TanStack Query + Dexie

**Files:**
- Create: `apps/web/src/lib/hooks/useSessions.ts`, `useExpenses.ts`, `useCustomers.ts`, `useRates.ts`
- Test: `apps/web/src/tests/useSessions.test.tsx` (`.tsx` — the test wraps the hook in a JSX `QueryClientProvider`)

**Interfaces:**
- Consumes: `db, enqueueOutbox` (Task 5), `calcTimeAmount, calcFrameAmount` (Task 2), `CATEGORIES` (Task 2).
- Produces: `useSessions(date: string)` → `{ sessions, addSession(category, resource), updateSession(id, patch), deleteSession(id) }`, read via `useLiveQuery`-style TanStack Query keyed off `['sessions', date]`, invalidated on every mutation. Consumed by `DailySalesView` (Task 7).

- [ ] **Step 1: Write the failing test**

`apps/web/src/tests/useSessions.test.tsx`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { db } from '../lib/db/dexie';
import { useSessions } from '../lib/hooks/useSessions';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useSessions', () => {
  beforeEach(async () => { await db.sessions.clear(); await db.outbox.clear(); await db.rates.clear(); });

  it('adds a time-based session and auto-calculates the amount on time entry', async () => {
    await db.rates.put({ category: '8-Ball', hour: 200, half: 100, value: null, updatedAt: new Date().toISOString() });
    const { result } = renderHook(() => useSessions('2026-07-23'), { wrapper });

    await act(async () => { await result.current.addSession('8-Ball', 'Table 1'); });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    const id = result.current.sessions[0].id;

    await act(async () => { await result.current.updateSession(id, { start: '09:00', end: '10:30' }); });
    await waitFor(() => expect(result.current.sessions[0].amount).toBe(300));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cue-room/web add @tanstack/react-query @tanstack/react-table && pnpm --filter @cue-room/web add -D @testing-library/react jsdom && pnpm --filter @cue-room/web test useSessions`
Expected: FAIL — `../lib/hooks/useSessions` doesn't exist.

- [ ] **Step 3: Implement `apps/web/src/lib/hooks/useSessions.ts`**

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox } from '../db/dexie';
import { CATEGORIES, calcTimeAmount, calcFrameAmount, type Session } from '@cue-room/shared';

async function loadRate(category: string) {
  return db.rates.get(category);
}

export function useSessions(date: string) {
  const qc = useQueryClient();
  const key = ['sessions', date];

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const all = await db.sessions.where('date').equals(date).toArray();
      return all.filter(s => !s.deletedAt);
    },
  });

  async function persist(session: Session) {
    await db.sessions.put(session);
    await enqueueOutbox('sessions', 'upsert', session.id, session as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: key });
  }

  async function addSession(category: string, resource: string) {
    const conf = CATEGORIES.find(c => c.name === category)!;
    const rate = await loadRate(category);
    const id = crypto.randomUUID();
    const session: Session = {
      id, category, resource, date, start: '', end: '',
      amount: conf.billing === 'frame' ? calcFrameAmount((rate?.value ?? 0)) : 0,
      method: 'Cash', customerId: null,
      updatedAt: new Date().toISOString(), deletedAt: null,
    };
    await persist(session);
  }

  async function updateSession(id: string, patch: Partial<Session>) {
    const existing = await db.sessions.get(id);
    if (!existing) return;
    let next: Session = { ...existing, ...patch, updatedAt: new Date().toISOString() };

    const conf = CATEGORIES.find(c => c.name === next.category)!;
    if (conf.billing === 'time' && ('start' in patch || 'end' in patch) && next.start && next.end) {
      const rate = await loadRate(next.category);
      if (rate) next.amount = calcTimeAmount(next.start, next.end, { hour: rate.hour ?? 0, half: rate.half ?? 0 });
    }
    await persist(next);
  }

  async function deleteSession(id: string) {
    const existing = await db.sessions.get(id);
    if (!existing) return;
    const deleted: Session = { ...existing, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await db.sessions.put(deleted);
    await enqueueOutbox('sessions', 'delete', id, { id });
    await qc.invalidateQueries({ queryKey: key });
  }

  return { sessions: query.data ?? [], isLoading: query.isLoading, addSession, updateSession, deleteSession };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cue-room/web test useSessions`
Expected: PASS.

- [ ] **Step 5: Implement `useExpenses`, `useCustomers`, `useRates` following the identical shape**

`apps/web/src/lib/hooks/useExpenses.ts`:
```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox } from '../db/dexie';
import type { Expense } from '@cue-room/shared';

export function useExpenses(date: string) {
  const qc = useQueryClient();
  const key = ['expenses', date];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await db.expenses.where('date').equals(date).toArray()).filter(e => !e.deletedAt),
  });

  async function addExpense() {
    const id = crypto.randomUUID();
    const expense: Expense = { id, date, description: '', amount: 0, method: 'Cash', updatedAt: new Date().toISOString(), deletedAt: null };
    await db.expenses.put(expense);
    await enqueueOutbox('expenses', 'upsert', id, expense as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: key });
  }

  async function updateExpense(id: string, patch: Partial<Expense>) {
    const existing = await db.expenses.get(id);
    if (!existing) return;
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await db.expenses.put(next);
    await enqueueOutbox('expenses', 'upsert', id, next as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: key });
  }

  async function deleteExpense(id: string) {
    const existing = await db.expenses.get(id);
    if (!existing) return;
    const next = { ...existing, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await db.expenses.put(next);
    await enqueueOutbox('expenses', 'delete', id, { id });
    await qc.invalidateQueries({ queryKey: key });
  }

  return { expenses: query.data ?? [], addExpense, updateExpense, deleteExpense };
}
```

`apps/web/src/lib/hooks/useCustomers.ts`:
```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox } from '../db/dexie';
import type { Customer, CreditEntry } from '@cue-room/shared';
import { calcCustomerBalance } from '@cue-room/shared';

export function useCustomers() {
  const qc = useQueryClient();
  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await db.customers.toArray()).filter(c => !c.deletedAt),
  });
  const sessionsQuery = useQuery({ queryKey: ['all-sessions'], queryFn: () => db.sessions.toArray() });
  const historyQuery = useQuery({ queryKey: ['credit-entries'], queryFn: () => db.creditEntries.toArray() });

  async function addCustomer(input: { name: string; phone?: string }) {
    const id = crypto.randomUUID();
    const customer: Customer = { id, name: input.name, phone: input.phone ?? '', updatedAt: new Date().toISOString(), deletedAt: null };
    await db.customers.put(customer);
    await enqueueOutbox('customers', 'upsert', id, customer as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: ['customers'] });
  }

  async function deleteCustomer(id: string) {
    const existing = await db.customers.get(id);
    if (!existing) return;
    const next = { ...existing, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await db.customers.put(next);
    await enqueueOutbox('customers', 'delete', id, { id });
    await qc.invalidateQueries({ queryKey: ['customers'] });
  }

  async function adjustCustomer(customerId: string, date: string, type: CreditEntry['type'], amount: number) {
    const id = crypto.randomUUID();
    const entry: CreditEntry = { id, customerId, date, type, amount, updatedAt: new Date().toISOString() };
    await db.creditEntries.put(entry);
    await enqueueOutbox('creditEntries', 'upsert', id, entry as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: ['credit-entries'] });
  }

  function balanceFor(customerId: string): number {
    return calcCustomerBalance(sessionsQuery.data ?? [], historyQuery.data ?? [], customerId);
  }

  return {
    customers: customersQuery.data ?? [],
    history: historyQuery.data ?? [],
    addCustomer, deleteCustomer, adjustCustomer, balanceFor,
  };
}
```

`apps/web/src/lib/hooks/useRates.ts`:
```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox, type RateRow } from '../db/dexie';
import { CATEGORIES, DEFAULT_RATES } from '@cue-room/shared';

export function useRates() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['rates'],
    queryFn: async () => {
      const rows = await db.rates.toArray();
      const byCategory = new Map(rows.map(r => [r.category, r]));
      return CATEGORIES.map(c => {
        const existing = byCategory.get(c.name);
        if (existing) return existing;
        const def = DEFAULT_RATES[c.name];
        return c.billing === 'frame'
          ? { category: c.name, hour: null, half: null, value: def as number, updatedAt: new Date().toISOString() }
          : { category: c.name, hour: (def as any).hour, half: (def as any).half, value: null, updatedAt: new Date().toISOString() };
      });
    },
  });

  async function setRate(row: RateRow) {
    const next = { ...row, updatedAt: new Date().toISOString() };
    await db.rates.put(next);
    await enqueueOutbox('rates', 'upsert', row.category, next as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: ['rates'] });
  }

  return { rates: query.data ?? [], setRate };
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/hooks apps/web/src/tests apps/web/package.json
git commit -m "feat(web): tanstack-query hooks over dexie for sessions/expenses/customers/rates"
```

---

### Task 7: Views — Daily Sales, Monthly Sales (with TanStack Table)

**Files:**
- Create: `apps/web/src/components/views/DailySalesView.tsx`
- Create: `apps/web/src/components/views/MonthlySalesView.tsx`

**Interfaces:**
- Consumes: `useSessions` (6), `useCustomers` (6), `CATEGORIES` (2), shadcn `Card, Select, Input, Button, Table` (4).
- Produces: default-exported view components rendered by `App.tsx`'s view switch (Task 10).

- [ ] **Step 1: Implement `DailySalesView.tsx`**

Build the date-stepper header (prev/next/Today using `dateStrOf`/`parseDate` from `@cue-room/shared`), the Total/Card/Cash/Credit summary strip (computed with `useMemo` from `sessions`), and per-category groups of shadcn `Card`s — one card per resource, an inline row per session (time-based: `Input type="time"` × 2, `Input type="number"` for amount, shadcn `Select` for method, shadcn `Select` for customer gated on `useCustomers().customers.length`, delete `Button`), an "Add session" `Button` calling `addSession`, and a subtotal computed via `useMemo`. Wrap the row-level fields with `react-hook-form` (`useFieldArray` is not needed since each row commits independently on blur/change — call `updateSession(id, patch)` directly `onChange`, matching the original spec's per-field auto-save behavior; validate each patch with `SessionSchema.partial()` client-side before calling `updateSession`, showing a shadcn `Form` field error inline if invalid, e.g. Credit method with no customer selected).

- [ ] **Step 2: Implement `MonthlySalesView.tsx`**

Use `@tanstack/react-table`'s `useReactTable` with columns `Date | Card | Cash | Credit | Total`, `data` built by iterating every day in `monthCursor`'s month against `db.sessions` (via a `useQuery(['month-sessions', year, month], ...)`), each row's `onClick` handler setting the shared `date`/`view` state (lifted to `App.tsx`, Task 10) to jump to Daily Sales for that day. Render the 3 category-total `Card`s above the table from the same query, grouped by `category`.

- [ ] **Step 3: Manual verification (no automated UI test — per Global Constraints)**

Run: `pnpm --filter @cue-room/web dev`, open the app, and confirm: adding an 8-Ball session and setting start/end auto-fills the amount from the default rate (₹200/hr); switching to Monthly Sales shows that amount on today's row and in the 8-Ball category total; clicking the row returns to Daily Sales on that date.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/views/DailySalesView.tsx apps/web/src/components/views/MonthlySalesView.tsx
git commit -m "feat(web): daily sales and monthly sales views"
```

---

### Task 8: Views — Customers, Credit Management (react-hook-form + zod)

**Files:**
- Create: `apps/web/src/components/views/CustomersView.tsx`
- Create: `apps/web/src/components/views/CreditManagementView.tsx`

**Interfaces:**
- Consumes: `useCustomers` (6), `CustomerDraftSchema`, `CreditDraftSchema` (3), shadcn `Form` (wraps react-hook-form context), `@tanstack/react-table` for the customers list.

- [ ] **Step 1: Implement `CustomersView.tsx`**

A react-hook-form form (`useForm({ resolver: zodResolver(CustomerDraftSchema) })`) with `name`/`phone` shadcn `Input`s inside shadcn `Form`/`FormField`, submitting to `addCustomer`. Below it, a `@tanstack/react-table` table (`Name | Phone | —`) over `useCustomers().customers`, each row with a delete `Button` calling `deleteCustomer`. Empty state message when there are no customers (matches the spec's copy about the Credit dropdown).

- [ ] **Step 2: Implement `CreditManagementView.tsx`**

One shadcn `Card` per customer: name/phone, a `balanceFor(customer.id)` figure, a small react-hook-form (`resolver: zodResolver(CreditDraftSchema)`) with an amount `Input` and two submit buttons ("Give credit" → `adjustCustomer(id, date, 'CREDIT_GIVEN', amount)`, "Record payment" → `'PAYMENT_RECEIVED'`), and a `useState`-toggled expandable section listing that customer's combined history: synthesize "Table charge" rows from `useCustomers().history` filtered where the session was `method === 'Credit'` for this `customerId` (query `db.sessions` for this), merged with manual `history` entries, sorted by `date` descending.

- [ ] **Step 3: Manual verification**

Add a customer, set a Daily Sales session to Credit + that customer, confirm Credit Management shows the balance and a "Table charge" history line; use "Record payment" and confirm the balance decreases and a "Payment received" line appears.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/views/CustomersView.tsx apps/web/src/components/views/CreditManagementView.tsx
git commit -m "feat(web): customers and credit management views"
```

---

### Task 9: Views — Expenses, Rate Management

**Files:**
- Create: `apps/web/src/components/views/ExpensesView.tsx`
- Create: `apps/web/src/components/views/RateManagementView.tsx`

**Interfaces:**
- Consumes: `useExpenses`, `useRates` (6), `ExpenseDraftSchema`, `TimeRateSchema`, `FrameRateSchema` (3).

- [ ] **Step 1: Implement `ExpensesView.tsx`**

Same date-stepper header pattern as Daily Sales (extract a shared `<DateStepper date={date} onChange={...} />` component used by both — put it in `apps/web/src/components/layout/DateStepper.tsx` and have Task 7's `DailySalesView` adopt it too, to avoid duplicating the prev/next/Today logic in two places). A row list of expenses (`Input` description, `Input type="number"` amount, `Select` Cash/Card, delete `Button`), each field committing via `updateExpense` on change, validated per-row against `ExpenseDraftSchema.partial()`. Day total via `useMemo`.

- [ ] **Step 2: Implement `RateManagementView.tsx`**

One `Card` per category from `useRates().rates`: time-based categories get two react-hook-form-bound `Input type="number"` fields ("Rate per 60 min", "Rate per 30 min") validated by `TimeRateSchema`; the frame-based category gets one ("Rate per frame") validated by `FrameRateSchema`. Each submits (or commits on blur) to `setRate`.

- [ ] **Step 3: Manual verification**

Change the 8-Ball hourly rate in Rate Management; add a new session and set start/end in Daily Sales; confirm the new amount uses the updated rate. Add/delete an expense and confirm the day total updates.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/views/ExpensesView.tsx apps/web/src/components/views/RateManagementView.tsx apps/web/src/components/layout/DateStepper.tsx
git commit -m "feat(web): expenses and rate management views, shared date stepper"
```

---

### Task 10: App shell — Sidebar + view switch (no auth/roles yet — added in Part C)

**Files:**
- Create: `apps/web/src/components/layout/Sidebar.tsx`, `apps/web/src/components/layout/AppShell.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: all six view components (7–9).
- Produces: `App.tsx` owns `view` (`ViewKey` from `@cue-room/shared`), `date`, `monthCursor`, `sidebarOpen` state and passes `date`/setters down — this is the same top-level state shape as the original spec's `Component`, just lifted into `App` instead of a class.

- [ ] **Step 1: Implement `Sidebar.tsx`**

A collapsible (220px ↔ 56px, per the spec) nav list using shadcn's `sidebar` primitives, one item per `ViewKey` (icons from `lucide-react`, already a shadcn dependency: `Calendar, BarChart3, Users, CreditCard, Receipt, Settings`), active item highlighted via the current `view` prop. (User Management item and role filtering are added in Task 22 — for now render all six business views.)

- [ ] **Step 2: Implement `AppShell.tsx`** — flex layout: `Sidebar` + a scrollable content pane rendering the active view.

- [ ] **Step 3: Wire `App.tsx`**

```tsx
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { todayStr } from '@cue-room/shared';
import { AppShell } from './components/layout/AppShell';
import { DailySalesView } from './components/views/DailySalesView';
import { MonthlySalesView } from './components/views/MonthlySalesView';
import { CustomersView } from './components/views/CustomersView';
import { CreditManagementView } from './components/views/CreditManagementView';
import { ExpensesView } from './components/views/ExpensesView';
import { RateManagementView } from './components/views/RateManagementView';

const queryClient = new QueryClient();

export default function App() {
  const [view, setView] = useState<'dailySales'|'monthlySales'|'customers'|'creditManagement'|'expenses'|'rateManagement'>('dailySales');
  const [date, setDate] = useState(todayStr());

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell view={view} onViewChange={setView}>
        {view === 'dailySales' && <DailySalesView date={date} onDateChange={setDate} />}
        {view === 'monthlySales' && <MonthlySalesView onJumpToDate={(d) => { setDate(d); setView('dailySales'); }} />}
        {view === 'customers' && <CustomersView />}
        {view === 'creditManagement' && <CreditManagementView />}
        {view === 'expenses' && <ExpensesView date={date} onDateChange={setDate} />}
        {view === 'rateManagement' && <RateManagementView />}
      </AppShell>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Manual verification**

Run: `pnpm --filter @cue-room/web dev`. Click through all six sidebar items; confirm each view renders, the sidebar collapse toggle works, and Monthly Sales → row click correctly switches to Daily Sales on that date.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/layout
git commit -m "feat(web): app shell with sidebar navigation across all six views"
```

---

### Task 11 (Final for Part A): Wrap with Tauri for desktop

**Files:**
- Create: `apps/web/src-tauri/Cargo.toml`, `apps/web/src-tauri/tauri.conf.json`, `apps/web/src-tauri/src/main.rs`
- Modify: `apps/web/package.json` (add `tauri` scripts)

- [ ] **Step 1: Add the Tauri CLI and initialize**

Run (from `apps/web`):
```bash
pnpm add -D @tauri-apps/cli
pnpm dlx @tauri-apps/cli init
```
When prompted: app name `Cue Room`, window title `Cue Room`, web assets `../dist`, dev server `http://localhost:5173`, dev command `pnpm dev`, build command `pnpm build`.

- [ ] **Step 2: Add scripts to `apps/web/package.json`**

```json
"scripts": {
  "tauri": "tauri",
  "desktop:dev": "tauri dev",
  "desktop:build": "tauri build"
}
```

- [ ] **Step 3: Verify the desktop shell boots against the same React app**

Run: `pnpm --filter @cue-room/web desktop:dev`
Expected: a native window opens showing the identical Cue Room UI as the browser build (Rust toolchain already confirmed present: `cargo 1.96.1`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src-tauri apps/web/package.json
git commit -m "feat(web): wrap frontend with tauri for the desktop build"
```

---

### Task 12: Standalone static build for `apps/web` (independent hosting)

**Files:**
- Create: `apps/web/Dockerfile`, `apps/web/nginx.conf`
- Modify: `apps/web/package.json` (build script already exists from the Vite template — verify it builds against the compiled `@cue-room/shared`, not its source)

**Interfaces:**
- Consumes: `packages/shared`'s built `dist/` (Task 2, Step 10).

- [ ] **Step 1: Confirm the production build depends on the compiled shared package**

Run: `pnpm --filter @cue-room/shared build && pnpm --filter @cue-room/web build`
Expected: `apps/web/dist/` contains the static site; no step reads from `packages/shared/src` (Vite resolves the workspace package via its `package.json` `main`/`types`, which point at `dist/` per Task 2 Step 10).

- [ ] **Step 2: `apps/web/Dockerfile`** (multi-stage: build at the monorepo root, ship only static files)

```dockerfile
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cue-room/shared build
RUN pnpm --filter @cue-room/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 3: `apps/web/nginx.conf`** (SPA fallback — client-side view switching has no server routes to match)

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  location / { try_files $uri /index.html; }
}
```

- [ ] **Step 4: Verify the image builds and serves**

Run (from the monorepo root): `docker build -f apps/web/Dockerfile -t cue-room-web .`
Then: `docker run --rm -p 8080:80 cue-room-web` and open `http://localhost:8080`
Expected: the same Cue Room UI as `pnpm dev:web`, served as a static site with zero Node runtime — confirms `apps/web` is independently deployable to any static/Nginx host, not just runnable from inside the monorepo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/Dockerfile apps/web/nginx.conf
git commit -m "feat(web): standalone static docker build, independent of the monorepo at runtime"
```

**Part A is now a fully working, offline, single-device app — runnable as a website (`pnpm dev:web`), as a desktop app (`pnpm --filter @cue-room/web desktop:dev`), and as a standalone static Docker image (Task 12).**

---

# PART B — Backend API (standalone; auth, RBAC, sync endpoints)

### Task 13: `apps/api` scaffold — Express + TypeScript + Prisma + PostgreSQL

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/prisma/schema.prisma`, `apps/api/src/env.ts`, `apps/api/src/db.ts`, `apps/api/src/server.ts`

- [ ] **Step 1: `apps/api/package.json`**

```json
{
  "name": "@cue-room/api",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "prisma:migrate": "prisma migrate dev",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "@cue-room/shared": "workspace:*",
    "@prisma/client": "^5.20.0",
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "prisma": "^5.20.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/bcrypt": "^5.0.2",
    "@types/node": "^22.7.0"
  }
}
```

- [ ] **Step 2: `apps/api/prisma/schema.prisma`**

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role { OWNER ADMIN CASHIER }
enum Method { Cash Card Credit }
enum CreditType { CREDIT_GIVEN PAYMENT_RECEIVED }

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String
  role         Role
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Session {
  id         String    @id @default(uuid())
  category   String
  resource   String
  date       String
  start      String
  end        String
  amount     Int
  method     Method
  customerId String?
  updatedAt  DateTime  @default(now())
  deletedAt  DateTime?

  @@index([date])
  @@index([customerId])
}

model Expense {
  id          String    @id @default(uuid())
  date        String
  description String
  amount      Int
  method      Method
  updatedAt   DateTime  @default(now())
  deletedAt   DateTime?

  @@index([date])
}

model Customer {
  id        String    @id @default(uuid())
  name      String
  phone     String    @default("")
  updatedAt DateTime  @default(now())
  deletedAt DateTime?
}

model CreditEntry {
  id         String     @id @default(uuid())
  customerId String
  date       String
  type       CreditType
  amount     Int
  updatedAt  DateTime   @default(now())

  @@index([customerId])
}

model Rate {
  category  String   @id
  hour      Int?
  half      Int?
  value     Int?
  updatedAt DateTime @default(now())
}
```

- [ ] **Step 3: `apps/api/src/env.ts`**

```ts
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
  PORT: Number(process.env.PORT ?? 4000),
};
```

- [ ] **Step 4: `apps/api/src/db.ts`**

```ts
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
```

- [ ] **Step 5: `apps/api/src/server.ts`** (routes wired in later tasks; stub now)

```ts
import express from 'express';
import cors from 'cors';
import { env } from './env';

export const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => console.log(`api listening on :${env.PORT}`));
}
```

- [ ] **Step 6: Provide a local `.env.example` (not `.env` — never commit real secrets)**

`apps/api/.env.example`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cue_room
JWT_ACCESS_SECRET=change-me-access
JWT_REFRESH_SECRET=change-me-refresh
PORT=4000
```
Tell the user to copy this to `apps/api/.env` and fill in a real Postgres connection string before running migrations — this plan does not provision a Postgres instance for them.

- [ ] **Step 7: Verify install and health check**

Run: `pnpm --filter @cue-room/api install && pnpm --filter @cue-room/api exec tsc --noEmit`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/prisma apps/api/src apps/api/.env.example
git commit -m "chore(api): scaffold express+prisma+postgres api"
```

---

### Task 14: Auth — password hashing, JWT issuing, login/register services (TDD)

**Files:**
- Create: `apps/api/src/lib/password.ts`, `apps/api/src/lib/jwt.ts`
- Create: `apps/api/src/services/auth.service.ts`
- Test: `apps/api/src/tests/jwt.test.ts`, `apps/api/src/tests/auth.service.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain): Promise<string>`, `verifyPassword(plain, hash): Promise<boolean>`; `signAccessToken({sub, role}): string`, `signRefreshToken({sub}): string`, `verifyAccessToken(token): {sub: string; role: Role}`. Consumed by `middleware/auth.ts` (Task 15) and `routes/auth.routes.ts` (Task 16).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/tests/jwt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../lib/jwt';

describe('jwt', () => {
  it('round-trips subject and role through sign/verify', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'CASHIER' });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('CASHIER');
  });

  it('throws on a tampered token', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'CASHIER' });
    expect(() => verifyAccessToken(token + 'x')).toThrow();
  });
});
```

`apps/api/src/tests/auth.service.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login } from '../services/auth.service';
import { hashPassword } from '../lib/password';
import { prisma } from '../db';

vi.mock('../db', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe('login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tokens for correct credentials', async () => {
    const passwordHash = await hashPassword('correct-horse-battery');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1', email: 'owner@cueroom.test', passwordHash, name: 'Owner', role: 'OWNER',
    });
    const result = await login('owner@cueroom.test', 'correct-horse-battery');
    expect(result.accessToken).toBeTypeOf('string');
    expect(result.user.role).toBe('OWNER');
  });

  it('rejects a wrong password', async () => {
    const passwordHash = await hashPassword('correct-horse-battery');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1', email: 'owner@cueroom.test', passwordHash, name: 'Owner', role: 'OWNER',
    });
    await expect(login('owner@cueroom.test', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('rejects an unknown email', async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);
    await expect(login('nobody@cueroom.test', 'whatever')).rejects.toThrow('Invalid credentials');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cue-room/api test`
Expected: FAIL — none of `lib/password`, `lib/jwt`, `services/auth.service` exist.

- [ ] **Step 3: Implement `apps/api/src/lib/password.ts`**

```ts
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Implement `apps/api/src/lib/jwt.ts`**

```ts
import jwt from 'jsonwebtoken';
import { env } from '../env';
import type { Role } from '@cue-room/shared';

export interface AccessTokenPayload { sub: string; role: Role }

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

export function signRefreshToken(payload: { sub: string }): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
}
```

- [ ] **Step 5: Implement `apps/api/src/services/auth.service.ts`**

```ts
import { prisma } from '../db';
import { verifyPassword } from '../lib/password';
import { signAccessToken, signRefreshToken } from '../lib/jwt';
import type { Role } from '@cue-room/shared';

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('Invalid credentials');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new Error('Invalid credentials');

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role as Role }),
    refreshToken: signRefreshToken({ sub: user.id }),
    user: { id: user.id, email: user.email, name: user.name, role: user.role as Role },
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @cue-room/api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib apps/api/src/services apps/api/src/tests
git commit -m "feat(api): password hashing, jwt issuing, login service"
```

---

### Task 15: RBAC middleware (TDD)

**Files:**
- Create: `apps/api/src/middleware/auth.ts`, `apps/api/src/middleware/requireRole.ts`
- Test: `apps/api/src/tests/requireRole.test.ts`

**Interfaces:**
- Consumes: `verifyAccessToken` (14), `hasAccess` (shared, 2).
- Produces: `authenticate` (Express middleware — populates `req.user = {sub, role}` from the `Authorization: Bearer` header or rejects 401), `requireView(view: ViewKey)` (Express middleware factory — 403s if `!hasAccess(req.user.role, view)`). Consumed by every protected route in Task 16.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/requireRole.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { requireView } from '../middleware/requireRole';

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('requireView', () => {
  it('allows a cashier into rateManagement (per the agreed permission matrix)', () => {
    const req: any = { user: { sub: 'u1', role: 'CASHIER' } };
    const res = mockRes();
    const next = vi.fn();
    requireView('rateManagement')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks a cashier from userManagement', () => {
    const req: any = { user: { sub: 'u1', role: 'CASHIER' } };
    const res = mockRes();
    const next = vi.fn();
    requireView('userManagement')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows owner into userManagement', () => {
    const req: any = { user: { sub: 'u1', role: 'OWNER' } };
    const res = mockRes();
    const next = vi.fn();
    requireView('userManagement')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cue-room/api test requireRole`
Expected: FAIL — `../middleware/requireRole` doesn't exist.

- [ ] **Step 3: Implement `apps/api/src/middleware/auth.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';

export interface AuthedRequest extends Request {
  user?: { sub: string; role: 'OWNER' | 'ADMIN' | 'CASHIER' };
}

export function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    req.user = verifyAccessToken(header.slice('Bearer '.length));
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```

- [ ] **Step 4: Implement `apps/api/src/middleware/requireRole.ts`**

```ts
import type { Response, NextFunction } from 'express';
import { hasAccess, type ViewKey } from '@cue-room/shared';
import type { AuthedRequest } from './auth';

export function requireView(view: ViewKey) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !hasAccess(req.user.role, view)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cue-room/api test requireRole`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware apps/api/src/tests/requireRole.test.ts
git commit -m "feat(api): jwt auth middleware and per-view RBAC guard"
```

---

### Task 16: Auth routes + users (owner/admin only) routes

**Files:**
- Create: `apps/api/src/routes/auth.routes.ts`, `apps/api/src/routes/users.routes.ts`
- Modify: `apps/api/src/server.ts` (mount routers)

**Interfaces:**
- Consumes: `login` (14), `authenticate`, `requireView` (15), `LoginSchema`, `CreateUserSchema` (shared, 3), `hashPassword` (14).
- Produces: `POST /auth/login`, `POST /users` (create — owner/admin only), `GET /users` (list — owner/admin only). Consumed by the frontend's `AuthContext` (Task 19) and `UserManagementView` (Task 22).

- [ ] **Step 1: Implement `apps/api/src/routes/auth.routes.ts`**

```ts
import { Router } from 'express';
import { LoginSchema } from '@cue-room/shared';
import { login } from '../services/auth.service';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await login(parsed.data.email, parsed.data.password);
    res.json(result);
  } catch {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});
```

- [ ] **Step 2: Implement `apps/api/src/routes/users.routes.ts`**

```ts
import { Router } from 'express';
import { CreateUserSchema } from '@cue-room/shared';
import { prisma } from '../db';
import { hashPassword } from '../lib/password';
import { authenticate } from '../middleware/auth';
import { requireView } from '../middleware/requireRole';

export const usersRouter = Router();
usersRouter.use(authenticate, requireView('userManagement'));

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, createdAt: true } });
  res.json(users);
});

usersRouter.post('/', async (req, res) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: { email: parsed.data.email, passwordHash, name: parsed.data.name, role: parsed.data.role as any },
    select: { id: true, email: true, name: true, role: true },
  });
  res.status(201).json(user);
});
```

- [ ] **Step 3: Mount both routers in `apps/api/src/server.ts`**

```ts
import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';
// ...after app.use(express.json());
app.use('/auth', authRouter);
app.use('/users', usersRouter);
```

- [ ] **Step 4: Manual verification (requires a real Postgres — see `.env.example` note in 13)**

Run migrations, seed one OWNER user by hand (a short one-off script or `prisma studio`), then:
```bash
curl -X POST http://localhost:4000/auth/login -H "Content-Type: application/json" -d '{"email":"owner@cueroom.test","password":"..."}'
```
Expected: `200` with `accessToken`/`refreshToken`/`user`. Then `GET /users` with that token in `Authorization: Bearer ...` returns the user list; the same call with no header returns `401`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes apps/api/src/server.ts
git commit -m "feat(api): auth login route and owner/admin-only user management routes"
```

---

### Task 17: Sync push/pull endpoints (TDD on the merge logic)

**Files:**
- Create: `apps/api/src/services/sync.service.ts`
- Create: `apps/api/src/routes/sync.routes.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/tests/sync.service.test.ts`

**Interfaces:**
- Consumes: `SyncPushSchema`, `SyncPullQuerySchema` (shared, 3), `authenticate` (15), Prisma models (13).
- Produces: `applyPush(entries: OutboxEntry[]): Promise<void>` (upserts/soft-deletes rows across the 5 syncable tables, server stamps `updatedAt`), `pullSince(since?: string): Promise<{sessions, expenses, customers, creditEntries, rates, serverTime: string}>`. Mounted as `POST /sync/push` and `GET /sync/pull`, both behind `authenticate`. Consumed by the frontend's `syncEngine` (Task 20).

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/sync.service.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyPush } from '../services/sync.service';
import { prisma } from '../db';

vi.mock('../db', () => ({
  prisma: {
    session: { upsert: vi.fn() },
    expense: { upsert: vi.fn() },
    customer: { upsert: vi.fn() },
    creditEntry: { upsert: vi.fn() },
    rate: { upsert: vi.fn() },
  },
}));

describe('applyPush', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts a customer row, letting the server stamp updatedAt', async () => {
    await applyPush([
      { table: 'customers', op: 'upsert', id: 'c1', payload: { id: 'c1', name: 'Ravi', phone: '' }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.customer.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1' },
      create: expect.objectContaining({ id: 'c1', name: 'Ravi' }),
      update: expect.objectContaining({ name: 'Ravi' }),
    }));
  });

  it('soft-deletes by setting deletedAt instead of removing the row', async () => {
    await applyPush([{ table: 'customers', op: 'delete', id: 'c1', payload: {}, clientUpdatedAt: new Date().toISOString() }]);
    const call = (prisma.customer.upsert as any).mock.calls[0][0];
    expect(call.update.deletedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cue-room/api test sync.service`
Expected: FAIL — `../services/sync.service` doesn't exist.

- [ ] **Step 3: Implement `apps/api/src/services/sync.service.ts`**

```ts
import { prisma } from '../db';
import type { OutboxEntry } from '@cue-room/shared';

export async function applyPush(entries: OutboxEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    const isDelete = entry.op === 'delete';
    const base = { ...entry.payload, updatedAt: now, deletedAt: isDelete ? now : null };

    switch (entry.table) {
      case 'customers':
        await prisma.customer.upsert({ where: { id: entry.id }, create: { id: entry.id, ...base } as any, update: base as any });
        break;
      case 'sessions':
        await prisma.session.upsert({ where: { id: entry.id }, create: { id: entry.id, ...base } as any, update: base as any });
        break;
      case 'expenses':
        await prisma.expense.upsert({ where: { id: entry.id }, create: { id: entry.id, ...base } as any, update: base as any });
        break;
      case 'creditEntries':
        await prisma.creditEntry.upsert({ where: { id: entry.id }, create: { id: entry.id, ...entry.payload, updatedAt: now } as any, update: { ...entry.payload, updatedAt: now } as any });
        break;
      case 'rates':
        await prisma.rate.upsert({ where: { category: entry.id }, create: { category: entry.id, ...entry.payload, updatedAt: now } as any, update: { ...entry.payload, updatedAt: now } as any });
        break;
    }
  }
}

export async function pullSince(since?: string) {
  const where = since ? { updatedAt: { gt: new Date(since) } } : {};
  const [sessions, expenses, customers, creditEntries, rates] = await Promise.all([
    prisma.session.findMany({ where }),
    prisma.expense.findMany({ where }),
    prisma.customer.findMany({ where }),
    prisma.creditEntry.findMany({ where }),
    prisma.rate.findMany({ where }),
  ]);
  return { sessions, expenses, customers, creditEntries, rates, serverTime: new Date().toISOString() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cue-room/api test sync.service`
Expected: PASS.

- [ ] **Step 5: Implement `apps/api/src/routes/sync.routes.ts`**

```ts
import { Router } from 'express';
import { SyncPushSchema } from '@cue-room/shared';
import { authenticate } from '../middleware/auth';
import { applyPush, pullSince } from '../services/sync.service';

export const syncRouter = Router();
syncRouter.use(authenticate);

syncRouter.post('/push', async (req, res) => {
  const parsed = SyncPushSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await applyPush(parsed.data.entries);
  res.json({ ok: true });
});

syncRouter.get('/pull', async (req, res) => {
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  res.json(await pullSince(since));
});
```

- [ ] **Step 6: Mount in `apps/api/src/server.ts`**

```ts
import { syncRouter } from './routes/sync.routes';
app.use('/sync', syncRouter);
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/sync.service.ts apps/api/src/routes/sync.routes.ts apps/api/src/server.ts apps/api/src/tests/sync.service.test.ts
git commit -m "feat(api): push/pull sync endpoints with last-write-wins upserts and soft deletes"
```

---

### Task 18: Standalone Docker image for `apps/api` (independent hosting)

**Files:**
- Create: `apps/api/Dockerfile`, `apps/api/.dockerignore`

**Interfaces:**
- Consumes: `packages/shared`'s built `dist/` (Task 2, Step 10), `pnpm deploy` (pnpm's built-in workspace-pruning command).

- [ ] **Step 1: `apps/api/Dockerfile`** (multi-stage: build at the monorepo root, ship a pruned standalone folder)

```dockerfile
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cue-room/shared build
RUN pnpm --filter @cue-room/api build
RUN pnpm --filter @cue-room/api exec prisma generate
RUN pnpm --filter @cue-room/api deploy --prod /out

FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /out .
EXPOSE 4000
CMD ["node", "dist/server.js"]
```
`pnpm deploy --prod /out` (run against the `@cue-room/api` filter) copies `apps/api`'s own files plus a *physical, non-symlinked* copy of `@cue-room/shared`'s compiled `dist/` into `/out` — the runtime stage that follows has no knowledge of the monorepo at all, just one self-contained Node app. This is what makes `apps/api` deployable to any single-folder-expecting host (a bare VPS, Railway, Render, Fly) exactly as easily as a non-monorepo Express project.

- [ ] **Step 2: `apps/api/.dockerignore`**

```
node_modules
dist
.env
```

- [ ] **Step 3: Verify the image builds and runs standalone**

Run (from the monorepo root, with a reachable `DATABASE_URL`): `docker build -f apps/api/Dockerfile -t cue-room-api .`
Then: `docker run --rm -p 4000:4000 --env-file apps/api/.env cue-room-api`
Expected: `curl http://localhost:4000/health` returns `{"ok":true}` from a container that only contains `/app` (the pruned `pnpm deploy` output) — no `/repo`, no other workspace packages, confirming `apps/api` runs independently of the monorepo at deploy time.

- [ ] **Step 4: Commit**

```bash
git add apps/api/Dockerfile apps/api/.dockerignore
git commit -m "feat(api): standalone docker build via pnpm deploy, independent of the monorepo at runtime"
```

**Part B is now a fully working, independently testable, independently deployable API — auth, RBAC, and sync — with no frontend or monorepo dependency at runtime.**

---

# PART C — Sync wiring, login, and role-gated navigation

### Task 19: API client + AuthContext (login, token storage, refresh)

**Files:**
- Create: `apps/web/src/lib/api/client.ts`, `apps/web/src/lib/auth/AuthContext.tsx`, `apps/web/src/lib/auth/useAuth.ts`
- Create: `apps/web/src/components/auth/LoginForm.tsx`
- Modify: `apps/web/src/App.tsx` (wrap in `AuthProvider`, render `LoginForm` when unauthenticated)

**Interfaces:**
- Consumes: `LoginSchema` (shared, 3), the `/auth/login` route (16).
- Produces: `useAuth()` → `{ user, accessToken, login(email, pw), logout() }`, consumed by `syncEngine` (20) and `Sidebar`/route-gating (22).

- [ ] **Step 1: Implement `apps/web/src/lib/api/client.ts`**

```ts
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export async function apiFetch(path: string, opts: RequestInit & { accessToken?: string | null } = {}) {
  const { accessToken, headers, ...rest } = opts;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Implement `apps/web/src/lib/auth/AuthContext.tsx`**

```tsx
import { createContext, useEffect, useState, type ReactNode } from 'react';
import type { Role } from '@cue-room/shared';
import { apiFetch } from '../api/client';

interface AuthUser { id: string; email: string; name: string; role: Role }
interface AuthState { user: AuthUser | null; accessToken: string | null }

export const AuthContext = createContext<{
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
} | null>(null);

const STORAGE_KEY = 'cue-room-auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null });

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) setState(JSON.parse(raw));
  }, []);

  async function login(email: string, password: string) {
    const result = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    const next: AuthState = { user: result.user, accessToken: result.accessToken };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    localStorage.setItem('cue-room-refresh', result.refreshToken);
    setState(next);
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('cue-room-refresh');
    setState({ user: null, accessToken: null });
  }

  return <AuthContext.Provider value={{ state, login, logout }}>{children}</AuthContext.Provider>;
}
```
Note: this stores the access token in `localStorage` for simplicity, matching the "same code path on web and desktop" goal — an OS-keychain-backed store (e.g. `tauri-plugin-stronghold`) for the desktop build is a reasonable future hardening step but is out of scope for this plan.

- [ ] **Step 3: Implement `apps/web/src/lib/auth/useAuth.ts`**

```ts
import { useContext } from 'react';
import { AuthContext } from './AuthContext';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 4: Implement `apps/web/src/components/auth/LoginForm.tsx`**

A react-hook-form (`resolver: zodResolver(LoginSchema)`) with email/password shadcn `Input`s inside shadcn `Form`, submitting to `useAuth().login`, surfacing the thrown error ("Invalid credentials") in a form-level error message.

- [ ] **Step 5: Wire into `App.tsx`**

Wrap the existing tree in `<AuthProvider>`; before rendering `AppShell`, check `useAuth().state.user` — render `LoginForm` if null.

- [ ] **Step 6: Manual verification**

With the API running and a seeded user, load the web app: unauthenticated shows the login form; correct credentials reveal the existing six-view app; wrong credentials show the inline error; reloading the page stays logged in (token in `localStorage`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api apps/web/src/lib/auth apps/web/src/components/auth apps/web/src/App.tsx
git commit -m "feat(web): auth context, login form, gate the app behind login"
```

---

### Task 20: Sync engine — outbox drain (push) + pull-merge loop

**Files:**
- Create: `apps/web/src/lib/sync/syncEngine.ts`
- Modify: `apps/web/src/App.tsx` (start/stop the engine based on auth state)

**Interfaces:**
- Consumes: `db, OutboxRow` (Task 5), `apiFetch` (19), `useAuth` (19).
- Produces: `startSyncEngine(accessToken: string): () => void` — drains `db.outbox` to `POST /sync/push` in batches, then `GET /sync/pull?since=<cursor>` and merges results into Dexie (only overwriting a local row if the incoming `updatedAt` is newer — the actual last-write-wins comparison), on an interval and on `window.online`. Returns a cleanup function.

- [ ] **Step 1: Implement `apps/web/src/lib/sync/syncEngine.ts`**

```ts
import { db } from '../db/dexie';
import { apiFetch } from '../api/client';

const CURSOR_KEY = 'cue-room-sync-cursor';
const TABLES = ['sessions', 'expenses', 'customers', 'creditEntries', 'rates'] as const;

async function push(accessToken: string) {
  const pending = await db.outbox.toArray();
  if (pending.length === 0) return;
  const entries = pending.map(p => ({ table: p.table, op: p.op, id: p.id, payload: p.payload, clientUpdatedAt: p.clientUpdatedAt }));
  await apiFetch('/sync/push', { method: 'POST', accessToken, body: JSON.stringify({ entries }) });
  await db.outbox.bulkDelete(pending.map(p => p.outboxId!));
}

async function mergeIncoming(table: (typeof TABLES)[number], rows: any[]) {
  const dexieTable = (db as any)[table];
  for (const row of rows) {
    const key = table === 'rates' ? row.category : row.id;
    const existing = await dexieTable.get(key);
    if (!existing || new Date(row.updatedAt) > new Date(existing.updatedAt)) {
      await dexieTable.put(row);
    }
  }
}

async function pull(accessToken: string) {
  const since = localStorage.getItem(CURSOR_KEY) ?? undefined;
  const result = await apiFetch(`/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`, { accessToken });
  for (const table of TABLES) await mergeIncoming(table, result[table]);
  localStorage.setItem(CURSOR_KEY, result.serverTime);
}

export function startSyncEngine(accessToken: string): () => void {
  let stopped = false;
  async function cycle() {
    if (stopped || !navigator.onLine) return;
    try { await push(accessToken); await pull(accessToken); } catch (e) { console.warn('sync cycle failed', e); }
  }
  const interval = setInterval(cycle, 30_000);
  const onOnline = () => cycle();
  window.addEventListener('online', onOnline);
  cycle();
  return () => { stopped = true; clearInterval(interval); window.removeEventListener('online', onOnline); };
}
```

- [ ] **Step 2: Start it from `App.tsx`**

```tsx
useEffect(() => {
  if (!state.accessToken) return;
  return startSyncEngine(state.accessToken);
}, [state.accessToken]);
```

- [ ] **Step 3: Manual verification (two-device / two-tab check)**

With the API + a Postgres instance running: log in on two browser tabs (or one tab + the Tauri desktop build) as the same user, add a customer in one, wait up to 30s (or toggle network off/on to force an immediate cycle), and confirm the customer appears in the other. Turn off network (devtools "Offline"), add a session, confirm it still saves locally and appears in Dexie's `outbox`; turn network back on and confirm it drains and appears via the API (`GET /sync/pull`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/sync/syncEngine.ts apps/web/src/App.tsx
git commit -m "feat(web): bidirectional sync engine — outbox push + last-write-wins pull merge"
```

---

### Task 21: Wire mutation hooks to also enqueue against the *authenticated* outbox (multi-tenant correctness)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (nothing further needed — sync endpoints are already scoped by `authenticate`, but confirm no cross-tenant leak)
- Modify: `apps/web/src/lib/sync/syncEngine.ts` docs note only

- [ ] **Step 1: Verify (manual read-through, not a code change) that `pullSince` in Task 17 returns all rows regardless of who wrote them**

Note: this app is single-business (one shop, multiple staff roles), not multi-tenant — every authenticated user is staff of the *same* pool hall and is meant to see the same data. `applyPush`/`pullSince` are intentionally shop-wide, not scoped per-user. If this ever needs to serve multiple separate pool halls, `Session`/`Expense`/`Customer`/etc. would need a `shopId` column and every sync query would need `where: { shopId: req.user.shopId }` — explicitly out of scope for this plan since the requirements describe one shop with role-based staff, not multi-tenant SaaS.

- [ ] **Step 2: No commit needed — this is a design-intent note, not a code task.**

---

### Task 22: Role-gated navigation + User Management view

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (filter items through `hasAccess`)
- Create: `apps/web/src/components/views/UserManagementView.tsx`
- Modify: `apps/web/src/App.tsx` (add `userManagement` to the view union, mount the new view)

**Interfaces:**
- Consumes: `hasAccess`, `ROLES` (shared, 2), `useAuth` (19), `CreateUserSchema` (shared, 3), `/users` routes (16).

- [ ] **Step 1: Filter `Sidebar.tsx` items by role**

```tsx
const items: { key: ViewKey; label: string; icon: LucideIcon }[] = [
  { key: 'dailySales', label: 'Daily Sales', icon: Calendar },
  { key: 'monthlySales', label: 'Monthly Sales', icon: BarChart3 },
  { key: 'customers', label: 'Customers', icon: Users },
  { key: 'creditManagement', label: 'Credit Management', icon: CreditCard },
  { key: 'expenses', label: 'Expenses', icon: Receipt },
  { key: 'rateManagement', label: 'Rate Management', icon: Settings },
  { key: 'userManagement', label: 'User Management', icon: ShieldCheck },
];
const visible = items.filter(item => hasAccess(role, item.key));
```

- [ ] **Step 2: Implement `UserManagementView.tsx`**

A react-hook-form (`resolver: zodResolver(CreateUserSchema)`) with `email/password/name` `Input`s and a `role` shadcn `Select` (`OWNER | ADMIN | CASHIER`), `POST /users` via `apiFetch` with the current `accessToken`. Below it, a `@tanstack/react-table` list from `GET /users` (`Name | Email | Role`).

- [ ] **Step 3: Guard the route itself, not just the nav item**

In `App.tsx`, before rendering `UserManagementView`, check `hasAccess(user.role, 'userManagement')` and render a "Not authorized" message otherwise — the sidebar filter hides the button, but the view must also refuse to render if reached another way (defense in depth; the *real* enforcement is server-side in `requireView` from Task 15 — this client check only prevents a confusing blank screen).

- [ ] **Step 4: Manual verification**

Log in as a seeded `CASHIER` user: confirm "User Management" is absent from the sidebar and every other view (including Rate Management and Credit Management, per the agreed matrix) is present and usable. Log in as `OWNER`: confirm User Management is visible, and creating a new `CASHIER` user there lets that user log in.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/views/UserManagementView.tsx apps/web/src/App.tsx
git commit -m "feat(web): role-gated sidebar and user management view"
```

**Part C completes the loop: login → role-gated UI → local-first read/write → background bidirectional sync against the self-hosted API, on both the web build and the Tauri desktop build.**

---

# PART D — End-to-end tests (Playwright)

This is the automated coverage for the JSX/view-composition work that Part A's Global Constraints deliberately excluded from unit testing — these tests drive the real rendered app in a real browser against the real API and Postgres from Part B, which is a truer check on the six views than a component-level test would be. Requires Part B's API reachable and a Postgres instance (same prerequisite as the "Final end-to-end verification" steps below); each test seeds and tears down its own data so they don't interfere with each other.

### Task 23: Playwright scaffold

**Files:**
- Create: `apps/e2e/package.json`, `apps/e2e/playwright.config.ts`
- Create: `apps/e2e/fixtures/seed.ts` (creates/deletes a test `OWNER` and `CASHIER` user directly via Prisma for each test run)

- [ ] **Step 1: `apps/e2e/package.json`**

```json
{
  "name": "@cue-room/e2e",
  "private": true,
  "scripts": { "test:e2e": "playwright test" },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@cue-room/api": "workspace:*"
  }
}
```
Depending on `@cue-room/api` lets the seed fixture import the same Prisma client and `hashPassword` the API uses, instead of re-implementing user creation.

- [ ] **Step 2: `apps/e2e/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // tests share one Postgres + API instance
  retries: 0,
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm --filter @cue-room/web dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 3: `apps/e2e/fixtures/seed.ts`**

```ts
import { prisma } from '@cue-room/api/src/db';
import { hashPassword } from '@cue-room/api/src/lib/password';

export async function seedUser(email: string, password: string, role: 'OWNER' | 'ADMIN' | 'CASHIER') {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name: role, role },
    update: { passwordHash, role },
  });
}

export async function cleanupAll() {
  await prisma.creditEntry.deleteMany();
  await prisma.session.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.rate.deleteMany();
  await prisma.user.deleteMany({ where: { email: { contains: '@e2e.test' } } });
}
```

- [ ] **Step 4: Verify the scaffold runs against a live API/DB (0 tests yet)**

Run: `pnpm --filter @cue-room/e2e test:e2e`
Expected: Playwright starts, reports "0 passed" (no test files yet) rather than a config/connection error.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e
git commit -m "chore(e2e): playwright scaffold with prisma-backed seed/cleanup fixtures"
```

---

### Task 24: E2E — login, add a Daily Sales session, verify auto-calculated amount and totals

**Files:**
- Create: `apps/e2e/tests/daily-sales.spec.ts`

**Interfaces:**
- Consumes: `seedUser`, `cleanupAll` (23).

- [ ] **Step 1: Implement `apps/e2e/tests/daily-sales.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { seedUser, cleanupAll } from '../fixtures/seed';

test.beforeEach(async () => { await cleanupAll(); await seedUser('owner@e2e.test', 'testpass123', 'OWNER'); });
test.afterAll(async () => { await cleanupAll(); });

test('logs in, adds an 8-Ball session, and sees the auto-calculated amount reflected in the day total', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@e2e.test');
  await page.getByLabel('Password').fill('testpass123');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByRole('heading', { name: 'Daily Sales' })).toBeVisible();
  await page.getByRole('button', { name: 'Add session' }).first().click();

  const row = page.getByRole('row').last();
  await row.getByLabel('Start').fill('09:00');
  await row.getByLabel('End').fill('11:00');

  await expect(row.getByLabel('Amount')).toHaveValue('400'); // 2h × default ₹200/hr for 8-Ball
  await expect(page.getByTestId('summary-total')).toContainText('₹400');
});
```

- [ ] **Step 2: Run test, confirm it drives the real app end-to-end**

Run: `pnpm --filter @cue-room/e2e test:e2e daily-sales`
Expected: PASS against the running `apps/web` dev server, `apps/api`, and Postgres. If the accessible-name selectors (`getByLabel('Start')`, `getByTestId('summary-total')`) don't yet match the DOM built in Tasks 7/19, add the missing `aria-label`/`data-testid` attributes to those components — this test is the executable spec for that wiring, matching the design in Task 7 ("Start/End/Amt/Pay/Customer" columns) and the summary strip in Task 7 ("Total/Card/Cash/Credit").

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/daily-sales.spec.ts
git commit -m "test(e2e): login + daily sales session amount auto-calc + totals"
```

---

### Task 25: E2E — credit flow (customer, credit session, balance, payment)

**Files:**
- Create: `apps/e2e/tests/credit-flow.spec.ts`

- [ ] **Step 1: Implement `apps/e2e/tests/credit-flow.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { seedUser, cleanupAll } from '../fixtures/seed';

test.beforeEach(async () => { await cleanupAll(); await seedUser('owner@e2e.test', 'testpass123', 'OWNER'); });
test.afterAll(async () => { await cleanupAll(); });

test('a Credit session raises the customer balance, and Record payment lowers it', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@e2e.test');
  await page.getByLabel('Password').fill('testpass123');
  await page.getByRole('button', { name: 'Log in' }).click();

  await page.getByRole('link', { name: 'Customers' }).click();
  await page.getByLabel('Customer name').fill('Ravi Kumar');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('Ravi Kumar')).toBeVisible();

  await page.getByRole('link', { name: 'Daily Sales' }).click();
  await page.getByRole('button', { name: 'Add session' }).first().click();
  const row = page.getByRole('row').last();
  await row.getByLabel('Amount').fill('300');
  await row.getByLabel('Pay').selectOption('Credit');
  await row.getByLabel('Customer').selectOption('Ravi Kumar');

  await page.getByRole('link', { name: 'Credit Management' }).click();
  await expect(page.getByTestId('balance-Ravi Kumar')).toContainText('₹300');

  await page.getByTestId('draft-amount-Ravi Kumar').fill('100');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByTestId('balance-Ravi Kumar')).toContainText('₹200');
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @cue-room/e2e test:e2e credit-flow`
Expected: PASS. Add the `data-testid="balance-<name>"` / `data-testid="draft-amount-<name>"` attributes to `CreditManagementView` (Task 8) if not already present — this test is the executable spec for the balance math in `calcCustomerBalance` (Task 2) actually reaching the screen correctly.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/credit-flow.spec.ts
git commit -m "test(e2e): credit session raises balance, record payment lowers it"
```

---

### Task 26: E2E — RBAC (cashier cannot see User Management; owner can)

**Files:**
- Create: `apps/e2e/tests/rbac.spec.ts`

- [ ] **Step 1: Implement `apps/e2e/tests/rbac.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { seedUser, cleanupAll } from '../fixtures/seed';

test.beforeEach(async () => {
  await cleanupAll();
  await seedUser('owner@e2e.test', 'testpass123', 'OWNER');
  await seedUser('cashier@e2e.test', 'testpass123', 'CASHIER');
});
test.afterAll(async () => { await cleanupAll(); });

test('cashier does not see User Management; owner does', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('cashier@e2e.test');
  await page.getByLabel('Password').fill('testpass123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('link', { name: 'User Management' })).toHaveCount(0);
  // per the agreed permission matrix, cashier still gets every business view:
  await expect(page.getByRole('link', { name: 'Rate Management' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Credit Management' })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await page.getByLabel('Email').fill('owner@e2e.test');
  await page.getByLabel('Password').fill('testpass123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('link', { name: 'User Management' })).toBeVisible();
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @cue-room/e2e test:e2e rbac`
Expected: PASS — this is the executable check on the exact permission matrix from Global Constraints ("`CASHIER` has full access to every business view... but not User Management").

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/rbac.spec.ts
git commit -m "test(e2e): cashier vs owner sidebar visibility matches the permission matrix"
```

---

### Task 27: E2E — offline-first + two-device bidirectional sync

**Files:**
- Create: `apps/e2e/tests/sync.spec.ts`

**Interfaces:**
- Consumes: `browser.newContext()` (Playwright) to simulate two independent devices logged into the same account, each with its own IndexedDB.

- [ ] **Step 1: Implement `apps/e2e/tests/sync.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { seedUser, cleanupAll } from '../fixtures/seed';

test.beforeEach(async () => { await cleanupAll(); await seedUser('owner@e2e.test', 'testpass123', 'OWNER'); });
test.afterAll(async () => { await cleanupAll(); });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@e2e.test');
  await page.getByLabel('Password').fill('testpass123');
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('a customer added on "device A" appears on "device B" after sync', async ({ browser }) => {
  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  const pageA = await deviceA.newPage();
  const pageB = await deviceB.newPage();

  await login(pageA);
  await login(pageB);

  await pageA.getByRole('link', { name: 'Customers' }).click();
  await pageA.getByLabel('Customer name').fill('Synced Customer');
  await pageA.getByRole('button', { name: 'Add customer' }).click();
  await expect(pageA.getByText('Synced Customer')).toBeVisible();

  await pageB.getByRole('link', { name: 'Customers' }).click();
  await expect(pageB.getByText('Synced Customer')).toBeVisible({ timeout: 35_000 }); // sync engine's 30s interval

  await deviceA.close();
  await deviceB.close();
});

test('data added while offline is queued locally and reaches the server once back online', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);

  await context.setOffline(true);
  await page.getByRole('link', { name: 'Expenses' }).click();
  await page.getByRole('button', { name: 'Add expense' }).click();
  const row = page.getByRole('row').last();
  await row.getByLabel('Description').fill('Offline expense');
  await row.getByLabel('Amount').fill('50');
  await expect(row.getByLabel('Description')).toHaveValue('Offline expense'); // usable immediately, no network needed

  await context.setOffline(false);
  await page.waitForTimeout(31_000); // let the sync engine's interval drain the outbox
  await page.reload();
  await expect(page.getByText('Offline expense')).toBeVisible();

  await context.close();
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @cue-room/e2e test:e2e sync`
Expected: PASS. This is the executable check on Task 20's sync engine and the offline-first claim in the plan's Goal — the actual behavior the earlier "Final end-to-end verification" steps 6–7 described manually.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/sync.spec.ts
git commit -m "test(e2e): two-device bidirectional sync and offline-queue-then-drain"
```

**Part D automates the manual walkthroughs from the "Final end-to-end verification" section below — run it in CI on every change to `apps/web` or `apps/api`.**

---

## Final end-to-end verification (run after all four parts)

1. `docker run --name cue-room-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=cue_room -p 5432:5432 -d postgres:16` (or point `DATABASE_URL` at any Postgres instance you already run).
2. `pnpm --filter @cue-room/api prisma:generate && pnpm --filter @cue-room/api prisma:migrate` — creates the schema.
3. Seed one `OWNER` user (a short ad-hoc script using `hashPassword` + `prisma.user.create`, or `prisma studio`).
4. `pnpm dev:api` and `pnpm dev:web` in two terminals; log in on the website.
5. `pnpm --filter @cue-room/web desktop:dev` in a third terminal; log in with the **same** account.
6. Add a Daily Sales session on the website; within 30s (or after toggling network) confirm it appears in the desktop app, and vice versa.
7. Go offline (devtools network throttling → Offline) on the website, add an expense, confirm it's usable immediately (local-first) and sits in the outbox; go back online and confirm it reaches the desktop app.
8. Create a `CASHIER` user via User Management (as Owner), log in as that cashier in an incognito window, confirm User Management is hidden and every business view (including Rate Management, per the agreed matrix) works.
9. `pnpm -r test` from the repo root — every Vitest suite across `shared`, `api`, `web` passes.
10. `pnpm --filter @cue-room/e2e test:e2e` — all four Playwright specs (Daily Sales amount auto-calc, credit flow, RBAC, two-device sync) pass against the running API + Postgres + web dev server, automating steps 4–8 above.
