import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { Session } from '../shared/schemas/session.schema';
import type { Expense } from '../shared/schemas/expense.schema';
import type { Customer } from '../shared/schemas/customer.schema';
import type { CreditEntry } from '../shared/schemas/creditEntry.schema';

// Tauri rejects with a raw string, not an Error -- normalize once here so
// every view's `e instanceof Error` catch block gets the real message.
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e) {
    throw e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
  }
}

export interface CategoryRow {
  id: string;
  name: string;
  billingType: 'time' | 'frame';
}

export interface StationRow {
  id: string;
  categoryId: string;
  name: string;
}

// Canonical field names (hour/half/value), matching lib/shared/schemas/rate.schema.ts,
// Postgres, and web -- translated at this boundary since Rust's own struct mirrors
// SQLite's local column names (hour_rate/half_rate/frame_rate) instead.
export interface RateRow {
  id: string;
  categoryId: string;
  hour: number | null;
  half: number | null;
  value: number | null;
  updatedAt: string;
}

export interface RawRateRow {
  id: string;
  categoryId: string;
  hourRate: number | null;
  halfRate: number | null;
  frameRate: number | null;
  updatedAt: string;
}

// Exported so a unit test can catch a hour/half/value field swap directly --
// e2e coverage only exercises this through react-hook-form defaultValues,
// which wouldn't fail on a swap (see sub-project 2 review, issue #4).
export function toRateRow(raw: RawRateRow): RateRow {
  return {
    id: raw.id,
    categoryId: raw.categoryId,
    hour: raw.hourRate,
    half: raw.halfRate,
    value: raw.frameRate,
    updatedAt: raw.updatedAt,
  };
}

export interface SessionPatch {
  start?: string;
  end?: string;
  amount?: number;
  method?: string | null;
  customerId?: string | null;
  paidAt?: string | null;
}

export interface OutboxEntryRow {
  id: number;
  tableName: string;
  op: 'upsert' | 'delete';
  entityId: string;
  payloadJson: string;
  clientUpdatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PulledRow {
  table: string;
  row: Record<string, unknown>;
}

export interface BackupInfo {
  filename: string;
  createdAt: string;
  sizeBytes: number;
}

export interface ProductCategoryRow {
  id: string;
  name: string;
}

export interface ProductRow {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  cost: number | null;
  stockQty: number;
  lowStockThreshold: number;
  barcode: string | null;
  active: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OrderRow {
  id: string;
  method: 'Cash' | 'Card' | 'Credit';
  total: number;
  customerId: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OrderItemRow {
  id: string;
  orderId: string;
  productId: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  updatedAt: string;
  metadata: string | null;
}

export interface OrderWithItems extends OrderRow {
  items: OrderItemRow[];
}

export interface CartItemInput {
  productId: string;
  qty: number;
}

// Thin typed wrappers over Tauri's invoke() -- the only place that talks to
// the Rust backend. Every call corresponds 1:1 to a #[tauri::command].
export const commands = {
  // Auth -- tokens live in the OS keychain, never localStorage.
  storeAuthTokens: (accessToken: string, refreshToken: string) =>
    invoke<void>('store_auth_tokens', { accessToken, refreshToken }),
  getAuthTokens: () => invoke<AuthTokens | null>('get_auth_tokens'),
  clearAuthTokens: () => invoke<void>('clear_auth_tokens'),

  // Who's logged in on this device -- stamps createdBy/updatedBy locally.
  setCurrentActor: (userId: string) => invoke<void>('set_current_actor', { userId }),
  clearCurrentActor: () => invoke<void>('clear_current_actor'),

  // Categories/stations -- pull-only except for admin category management.
  listCategories: () => invoke<CategoryRow[]>('list_categories'),
  createCategory: (name: string, billingType: string) =>
    invoke<CategoryRow>('create_category', { name, billingType }),
  updateCategory: (id: string, name: string, billingType: string) =>
    invoke<CategoryRow>('update_category', { id, name, billingType }),
  listStations: () => invoke<StationRow[]>('list_stations'),
  createStation: (categoryId: string, name: string) => invoke<StationRow>('create_station', { categoryId, name }),
  updateStation: (id: string, name: string) => invoke<StationRow>('update_station', { id, name }),

  // Backup/restore (admin-only, 'backupRestore' permission)
  backupNow: () => invoke<BackupInfo>('backup_now'),
  listBackups: () => invoke<BackupInfo[]>('list_backups'),
  restoreBackup: (filename: string) => invoke<void>('restore_backup', { filename }),
  getBackupDir: () => invoke<string>('get_backup_dir'),

  // Rates
  listRates: async () => (await invoke<RawRateRow[]>('list_rates')).map(toRateRow),
  upsertRate: async (
    categoryId: string,
    hour: number | null,
    half: number | null,
    value: number | null,
  ) => toRateRow(await invoke<RawRateRow>('upsert_rate', { categoryId, hourRate: hour, halfRate: half, frameRate: value })),

  // Customers
  listCustomers: () => invoke<Customer[]>('list_customers'),
  createCustomer: (name: string, phone: string) => invoke<Customer>('create_customer', { name, phone }),
  deleteCustomer: (id: string) => invoke<void>('delete_customer', { id }),

  // Sessions
  listAllSessions: () => invoke<Session[]>('list_all_sessions'),
  listSessionsBetween: (startDate: string, endDate: string) =>
    invoke<Session[]>('list_sessions_between', { startDate, endDate }),
  listSessionsForDate: (date: string) => invoke<Session[]>('list_sessions_for_date', { date }),
  createSession: (stationId: string, categoryId: string, billingType: string, date: string) =>
    invoke<Session>('create_session', { stationId, categoryId, billingType, date }),
  updateSession: (id: string, patch: SessionPatch) => invoke<Session>('update_session', { id, patch }),
  deleteSession: (id: string) => invoke<void>('delete_session', { id }),

  // Expenses
  listExpensesForDate: (date: string) => invoke<Expense[]>('list_expenses_for_date', { date }),
  listExpensesBetween: (startDate: string, endDate: string) =>
    invoke<Expense[]>('list_expenses_between', { startDate, endDate }),
  createExpense: (date: string) => invoke<Expense>('create_expense', { date }),
  updateExpense: (id: string, description?: string, amount?: number, method?: string) =>
    invoke<Expense>('update_expense', { id, description, amount, method }),
  deleteExpense: (id: string) => invoke<void>('delete_expense', { id }),

  // Credit entries
  listCreditEntries: () => invoke<CreditEntry[]>('list_credit_entries'),
  createCreditEntry: (customerId: string, date: string, entryType: string, amount: number) =>
    invoke<CreditEntry>('create_credit_entry', { customerId, date, entryType, amount }),

  // Sync
  drainOutbox: () => invoke<OutboxEntryRow[]>('drain_outbox'),
  deleteOutboxEntries: (ids: number[]) => invoke<void>('delete_outbox_entries', { ids }),
  applyPulledRows: (rows: PulledRow[]) => invoke<void>('apply_pulled_rows', { rows }),

  // Cafe: products are admin-managed; create_order is the cashier checkout.
  listProductCategories: () => invoke<ProductCategoryRow[]>('list_product_categories'),
  createProductCategory: (name: string) => invoke<ProductCategoryRow>('create_product_category', { name }),
  listProducts: () => invoke<ProductRow[]>('list_products'),
  createProduct: (
    categoryId: string,
    name: string,
    price: number,
    cost: number | null,
    lowStockThreshold: number,
    barcode: string | null,
  ) => invoke<ProductRow>('create_product', { categoryId, name, price, cost, lowStockThreshold, barcode }),
  updateProduct: (
    id: string,
    name: string,
    price: number,
    cost: number | null,
    lowStockThreshold: number,
    barcode: string | null,
    active: boolean,
  ) => invoke<ProductRow>('update_product', { id, name, price, cost, lowStockThreshold, barcode, active }),
  adjustStock: (productId: string, delta: number, reason: string, note: string | null) =>
    invoke<ProductRow>('adjust_stock', { productId, delta, reason, note }),
  createOrder: (items: CartItemInput[], method: string, customerId: string | null) =>
    invoke<OrderWithItems>('create_order', { items, method, customerId }),
  listAllOrders: () => invoke<OrderRow[]>('list_all_orders'),
  listOrdersBetween: (startUtc: string, endUtc: string) =>
    invoke<OrderRow[]>('list_orders_between', { startUtc, endUtc }),
  listOrderItemsBetween: (startUtc: string, endUtc: string) =>
    invoke<OrderItemRow[]>('list_order_items_between', { startUtc, endUtc }),

  // Reports
  getMonthlyReport: (startDate: string, endDate: string, startUtc: string, endUtc: string) =>
    invoke<MonthlyReportResult>('get_monthly_report', { startDate, endDate, startUtc, endUtc }),
  // Returns a plain { customerId: balance } object.
  getCustomerBalances: () =>
    invoke<Record<string, number>>('get_customer_balances'),
  getCustomerCreditHistory: (customerId: string) =>
    invoke<CustomerHistoryRow[]>('get_customer_credit_history', { customerId }),
};

export interface DailyCategoryTotal {
  date: string;
  categoryId: string;
  method: 'Cash' | 'Card' | 'Credit' | null;
  total: number;
}

export interface DailyExpenseTotal {
  date: string;
  method: 'Cash' | 'Card';
  total: number;
}

export interface DailyCafeTotal {
  date: string;
  method: 'Cash' | 'Card' | 'Credit';
  total: number;
  profit: number;
}

export interface MonthlyReportResult {
  sessionTotals: DailyCategoryTotal[];
  expenseTotals: DailyExpenseTotal[];
  cafeTotals: DailyCafeTotal[];
}

export interface CustomerHistoryRow {
  id: string;
  date: string;
  label: string;
  amount: number;
  direction: 'charge' | 'payment';
}
