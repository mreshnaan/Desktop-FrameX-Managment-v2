import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type CartItemInput } from '../tauri/commands';
import { dateStrOf, localDateRangeToUtc } from '../shared/utils/dates';

// Orders have no `date` column -- updatedAt (a UTC instant) is the day they
// belong to. Read via local calendar date, not a UTC substring (see
// localDateRangeToUtc for why that drifts near local midnight).
export function orderDateOf(updatedAt: string): string {
  return dateStrOf(new Date(updatedAt));
}

export function orderTimeOf(updatedAt: string): string {
  return new Date(updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Only exposes checkout -- CafeView never reads back a list (the cart lives
// in useCart()); see useOrdersBetween below for historical reads.
export function useOrders() {
  const qc = useQueryClient();

  async function checkout(items: CartItemInput[], method: string, customerId: string | null) {
    const order = await commands.createOrder(items, method, customerId);
    // Invalidating the ['orders']/['order-items'] prefix also catches
    // useOrdersBetween's more specific keys.
    await qc.invalidateQueries({ queryKey: ['orders'] });
    await qc.invalidateQueries({ queryKey: ['order-items'] });
    // Checkout decrements stock server-side -- refresh products too.
    await qc.invalidateQueries({ queryKey: ['products'] });
    return order;
  }

  return { checkout };
}

// Bounded by date range at the Rust/SQL layer, not fetched-then-filtered
// here -- same pattern as useSessions/listSessionsBetween.
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
