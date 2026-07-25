import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import type { Session, Expense, Customer, CreditEntry, Billing } from '@/lib/shared';

export interface CategoryRow {
  id: string;
  name: string;
  billingType: Billing;
}

export interface StationRow {
  id: string;
  categoryId: string;
  name: string;
}

export interface RateRow {
  id: string;
  categoryId: string;
  hour: number | null;
  half: number | null;
  value: number | null;
  updatedAt: string;
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
  stockQty: number;
  lowStockThreshold: number;
  active: boolean;
  deletedAt: string | null;
}

export interface OrderRow {
  id: string;
  method: string;
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
}

export interface PullResult {
  sessions: Session[];
  expenses: Expense[];
  customers: Customer[];
  creditEntries: CreditEntry[];
  rates: RateRow[];
  categories: CategoryRow[];
  stations: StationRow[];
  productCategories: ProductCategoryRow[];
  products: ProductRow[];
  orders: OrderRow[];
  orderItems: OrderItemRow[];
}

// Web is a read-only analytics dashboard for every business view except User
// Management (which reads/writes the API directly and never goes through
// this hook) -- there is no local storage and nothing here ever writes back.
// The desktop app is the single place a shift is actually run from; every
// view here just fetches the current server state and derives what it needs.
export function usePullData() {
  const { state } = useAuth();
  return useQuery({
    queryKey: ['pull'],
    queryFn: () => apiFetch<PullResult>('/sync/pull', { accessToken: state.accessToken }),
  });
}
