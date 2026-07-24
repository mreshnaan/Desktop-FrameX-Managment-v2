import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/shared';
import { useProducts, productsByCategory } from '@/lib/hooks/useProducts';
import { useCart } from '@/lib/hooks/useCart';
import { useOrders } from '@/lib/hooks/useOrders';
import { useCustomers } from '@/lib/hooks/useCustomers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ListSkeleton } from '@/components/ui/list-skeleton';

export default function CafeView() {
  const { categories, products, isLoading } = useProducts();
  const { lines, total, addToCart, removeFromCart, setQty, clearCart } = useCart();
  const { checkout } = useOrders();
  const { customers } = useCustomers();
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState<'Cash' | 'Card' | 'Credit'>('Cash');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    return products.filter(p => p.active && p.name.toLowerCase().includes(q));
  }, [products, search]);

  async function completeSale() {
    if (lines.length === 0) return;
    if (method === 'Credit' && !customerId) {
      setError('A customer must be selected for Credit sales');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await checkout(
        lines.map(l => ({ productId: l.product.id, qty: l.qty })),
        method,
        method === 'Credit' ? customerId : null,
      );
      clearCart();
      setMethod('Cash');
      setCustomerId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <Input
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search products"
        />
        {isLoading ? (
          <ListSkeleton />
        ) : filteredProducts ? (
          <ProductGrid products={filteredProducts} onAdd={addToCart} />
        ) : (
          categories.map(category => {
            const items = productsByCategory(products, category.id);
            if (items.length === 0) return null;
            return (
              <section key={category.id} className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">{category.name}</h2>
                <ProductGrid products={items} onAdd={addToCart} />
              </section>
            );
          })
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Cart</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {lines.map(line => (
                <div key={line.product.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{line.product.name}</span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={line.qty}
                      onChange={e => setQty(line.product.id, Number(e.target.value) || 0)}
                      className="w-14"
                      aria-label={`Quantity for ${line.product.name}`}
                    />
                    <span className="w-16 text-right">{formatCurrency(line.product.price * line.qty)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${line.product.name}`}
                      onClick={() => removeFromCart(line.product.id)}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
            <span>Total</span>
            <span data-testid="cafe-total">{formatCurrency(total)}</span>
          </div>

          <Select value={method} onValueChange={v => setMethod(v as 'Cash' | 'Card' | 'Credit')}>
            <SelectTrigger aria-label="Payment method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Cash">Cash</SelectItem>
              <SelectItem value="Card">Card</SelectItem>
              <SelectItem value="Credit">Credit</SelectItem>
            </SelectContent>
          </Select>

          {method === 'Credit' && (
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger aria-label="Customer">
                <SelectValue placeholder="Select customer">
                  {(value: string | null) => customers.find(c => c.id === value)?.name ?? 'Select customer'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {customers.map(c => (
                  <SelectItem key={c.id} value={c.id} label={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="button" disabled={submitting || lines.length === 0} onClick={completeSale}>
            Complete sale
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ProductGrid({
  products,
  onAdd,
}: {
  products: ReturnType<typeof productsByCategory>;
  onAdd: (product: ReturnType<typeof productsByCategory>[number]) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {products.map(product => (
        <button
          key={product.id}
          type="button"
          onClick={() => onAdd(product)}
          className="flex flex-col items-start gap-1 rounded-lg border border-border p-3 text-left hover:bg-muted"
        >
          <span className="text-sm font-medium">{product.name}</span>
          <span className="text-sm text-muted-foreground">{formatCurrency(product.price)}</span>
          {product.stockQty <= product.lowStockThreshold && (
            <span className="text-xs font-medium text-destructive">Low stock ({product.stockQty})</span>
          )}
        </button>
      ))}
    </div>
  );
}
