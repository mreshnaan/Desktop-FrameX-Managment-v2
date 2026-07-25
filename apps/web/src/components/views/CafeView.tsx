import { useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/shared';
import { usePullData } from '@/lib/hooks/usePullData';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString();
}

// Read-only, like the rest of web's dashboard views -- fetches straight
// from /sync/pull, the same data desktop's Cafe/Products & Stock screens
// write.
export default function CafeView() {
  const [tab, setTab] = useState<'products' | 'orders'>('products');

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <Button type="button" variant={tab === 'products' ? 'default' : 'outline'} size="sm" onClick={() => setTab('products')}>
          Products & Stock
        </Button>
        <Button type="button" variant={tab === 'orders' ? 'default' : 'outline'} size="sm" onClick={() => setTab('orders')}>
          Orders
        </Button>
      </div>
      {tab === 'products' ? <ProductsTable /> : <OrdersTable />}
    </div>
  );
}

function ProductsTable() {
  const query = usePullData();

  const rows = useMemo(() => {
    if (!query.data) return [];
    const categoryName = new Map(query.data.productCategories.map(c => [c.id, c.name]));
    return query.data.products
      .filter(p => !p.deletedAt)
      .map(p => ({ ...p, categoryName: categoryName.get(p.categoryId) ?? 'Unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Products & Stock</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {query.isLoading ? (
          <p className="px-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">No products yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="text-muted-foreground">{p.categoryName}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{formatCurrency(p.price)}</TableCell>
                  <TableCell className={p.stockQty <= p.lowStockThreshold ? 'font-medium text-destructive' : undefined}>
                    {p.stockQty}
                  </TableCell>
                  <TableCell>{p.active ? 'Active' : 'Inactive'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function OrdersTable() {
  const query = usePullData();

  const rows = useMemo(() => {
    if (!query.data) return [];
    const itemCount = new Map<string, number>();
    for (const item of query.data.orderItems) {
      itemCount.set(item.orderId, (itemCount.get(item.orderId) ?? 0) + item.qty);
    }
    return query.data.orders
      .filter(o => !o.deletedAt)
      .map(o => ({ ...o, items: itemCount.get(o.id) ?? 0 }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [query.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {query.isLoading ? (
          <p className="px-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(o => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatWhen(o.updatedAt)}</TableCell>
                  <TableCell>{o.method}</TableCell>
                  <TableCell>{o.items}</TableCell>
                  <TableCell>{formatCurrency(o.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
