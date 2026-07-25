import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type CartItemInput } from '../tauri/commands';
import { dateStrOf, localDateRangeToUtc } from '../shared/utils/dates';

// Order.updatedAt is a full ISO datetime, not a plain date string like
// Session.date -- orders have no "which day is this for" field of their own
// since (unlike a table session) they're never edited after checkout, so the
// moment they were created IS the day they belong to. updatedAt is stamped
// in UTC (see the Rust side's now_iso()), so "which day" must be read via
// the local calendar date, not a UTC substring -- see localDateRangeToUtc's
// comment for why a bare substring drifts by a day near local midnight.
export function orderDateOf(updatedAt: string): string {
  return dateStrOf(new Date(updatedAt));
}

export function orderTimeOf(updatedAt: string): string {
  return new Date(updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Only exposes checkout -- CafeView is the sole caller and never reads back
// an orders/order-items list of its own (the cart lives in useCart()).
// Reading historical orders is a separate, bounded concern; see
// useOrdersBetween below.
export function useOrders() {
  const qc = useQueryClient();

  async function checkout(items: CartItemInput[], method: string, customerId: string | null) {
    const order = await commands.createOrder(items, method, customerId);
    // Invalidating the ['orders']/['order-items'] key prefix also catches
    // any more specific ['orders', start, end] query from useOrdersBetween.
    await qc.invalidateQueries({ queryKey: ['orders'] });
    await qc.invalidateQueries({ queryKey: ['order-items'] });
    // Checkout decrements stock server-side (Rust) -- refresh products so
    // the grid reflects the new stock levels immediately.
    await qc.invalidateQueries({ queryKey: ['products'] });
    return order;
  }

  return { checkout };
}

// Bounded by date range at the Rust/SQL layer (list_orders_between /
// list_order_items_between), not fetched in full and filtered here -- the
// same pattern useSessions/listSessionsBetween already uses, so a growing
// order history never becomes a bigger and bigger payload on every render.
export function useOrdersBetween(startDate: string, endDate: string) {
  const { startUtc, endUtc } = localDateRangeToUtc(startDate, endDate);
  const ordersQuery = useQuery({
    queryKey: ['orders', startDate, endDate],
    queryFn: () => commands.listOrdersBetween(startUtc, endUtc),
  });
  const orderItemsQuery = useQuery({
    queryKey: ['order-items', startDate, endDate],
    queryFn: () => commands.listOrderItemsBetween(startUtc, endUtc),
  });

  return {
    orders: ordersQuery.data ?? [],
    orderItems: orderItemsQuery.data ?? [],
    isLoading: ordersQuery.isLoading || orderItemsQuery.isLoading,
  };
}
