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

export interface OfferRow {
  id: string;
  name: string;
  active: boolean;
  appliesToAllCategories: boolean;
  categoryIds: string | null;
  days: string | null;
  startTime: string | null;
  endTime: string | null;
  startDate: string | null;
  endDate: string | null;
  minDurationMinutes: number | null;
  minGameCount: number | null;
  effectType: 'extraTime' | 'percentOff' | 'flatOff';
  effectValue: number;
  updatedAt: string;
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
  offers: OfferRow[];
}

// Web is a read-only dashboard -- no local storage, nothing here writes
// back. Desktop is the only place a shift is actually run from.
export function usePullData() {
  const { state } = useAuth();
  return useQuery({
    queryKey: ['pull'],
    queryFn: () => apiFetch<PullResult>('/sync/pull', { accessToken: state.accessToken }),
  });
}
