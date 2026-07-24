import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type CartItemInput } from '../tauri/commands';

export function useOrders() {
  const qc = useQueryClient();
  const ordersQuery = useQuery({ queryKey: ['orders'], queryFn: () => commands.listAllOrders() });

  async function checkout(items: CartItemInput[], method: string, customerId: string | null) {
    const order = await commands.createOrder(items, method, customerId);
    await qc.invalidateQueries({ queryKey: ['orders'] });
    // Checkout decrements stock server-side (Rust) -- refresh products so
    // the grid reflects the new stock levels immediately.
    await qc.invalidateQueries({ queryKey: ['products'] });
    return order;
  }

  return { orders: ordersQuery.data ?? [], checkout };
}
