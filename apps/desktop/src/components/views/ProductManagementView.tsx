import { useState } from 'react';
import { formatCurrency } from '@/lib/shared';
import { useProducts, productsByCategory } from '@/lib/hooks/useProducts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import type { ProductRow } from '@/lib/tauri/commands';

export default function ProductManagementView() {
  const { categories, products, isLoading, addCategory, addProduct, updateProduct, adjustStock } = useProducts();

  return (
    <div className="flex flex-col gap-6 p-4">
      <NewCategoryCard onCreated={addCategory} />
      <NewProductCard categories={categories} onCreated={addProduct} />
      {isLoading ? (
        <ListSkeleton />
      ) : (
        categories.map(category => {
          const items = productsByCategory(products, category.id).concat(
            products.filter(p => p.categoryId === category.id && !p.active),
          );
          if (items.length === 0) return null;
          return (
            <Card key={category.id}>
              <CardHeader>
                <CardTitle>{category.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {items.map(product => (
                  <ProductRowEditor
                    key={product.id}
                    product={product}
                    onSave={updateProduct}
                    onAdjustStock={adjustStock}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function NewCategoryCard({ onCreated }: { onCreated: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onCreated(name.trim());
      setName('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add product category</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup className="@md/field-group:flex-row @md/field-group:items-end">
          <Field>
            <FieldLabel htmlFor="new-product-category">Name</FieldLabel>
            <Input id="new-product-category" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Snacks" />
          </Field>
          <Button type="button" disabled={submitting || !name.trim()} onClick={submit}>
            Add category
          </Button>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

function NewProductCard({
  categories,
  onCreated,
}: {
  categories: { id: string; name: string }[];
  onCreated: (input: { categoryId: string; name: string; price: number; cost: number | null; lowStockThreshold: number; barcode: string | null }) => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const priceNum = Number(price);
    if (!categoryId || !name.trim() || !Number.isFinite(priceNum) || priceNum < 0) {
      setError('Category, name, and a valid price are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onCreated({ categoryId, name: name.trim(), price: Math.round(priceNum), cost: null, lowStockThreshold: 0, barcode: null });
      setName('');
      setPrice('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add product</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup className="@md/field-group:flex-row @md/field-group:items-end">
          <Field>
            <FieldLabel htmlFor="new-product-cat">Category</FieldLabel>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="new-product-cat">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id} label={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-product-name">Name</FieldLabel>
            <Input id="new-product-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cola" />
          </Field>
          <Field className="@md/field-group:max-w-32">
            <FieldLabel htmlFor="new-product-price">Price</FieldLabel>
            <Input id="new-product-price" type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} />
          </Field>
          <Button type="button" disabled={submitting} onClick={submit}>
            Add product
          </Button>
        </FieldGroup>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ProductRowEditor({
  product,
  onSave,
  onAdjustStock,
}: {
  product: ProductRow;
  onSave: (input: { id: string; name: string; price: number; cost: number | null; lowStockThreshold: number; barcode: string | null; active: boolean }) => Promise<void>;
  onAdjustStock: (productId: string, delta: number, reason: string, note: string | null) => Promise<void>;
}) {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [stockDelta, setStockDelta] = useState('');

  async function save() {
    const priceNum = Number(price);
    if (!name.trim() || !Number.isFinite(priceNum) || priceNum < 0) return;
    await onSave({
      id: product.id, name: name.trim(), price: Math.round(priceNum), cost: product.cost,
      lowStockThreshold: product.lowStockThreshold, barcode: product.barcode, active: product.active,
    });
  }

  async function toggleActive() {
    await onSave({
      id: product.id, name: product.name, price: product.price, cost: product.cost,
      lowStockThreshold: product.lowStockThreshold, barcode: product.barcode, active: !product.active,
    });
  }

  async function applyStockDelta() {
    const delta = Number(stockDelta);
    if (!Number.isFinite(delta) || delta === 0) return;
    await onAdjustStock(product.id, Math.round(delta), 'correction', null);
    setStockDelta('');
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
      <Field>
        <FieldLabel htmlFor={`product-name-${product.id}`}>Name</FieldLabel>
        <Input id={`product-name-${product.id}`} value={name} onChange={e => setName(e.target.value)} className="w-40" />
      </Field>
      <Field className="max-w-28">
        <FieldLabel htmlFor={`product-price-${product.id}`}>Price</FieldLabel>
        <Input id={`product-price-${product.id}`} type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} />
      </Field>
      <Button type="button" variant="outline" size="sm" onClick={save}>
        Save
      </Button>
      <span className="text-sm text-muted-foreground">Stock: {product.stockQty}</span>
      <Field className="max-w-24">
        <FieldLabel htmlFor={`product-stock-${product.id}`}>Adjust by</FieldLabel>
        <Input
          id={`product-stock-${product.id}`}
          type="number"
          value={stockDelta}
          onChange={e => setStockDelta(e.target.value)}
          placeholder="+/-"
        />
      </Field>
      <Button type="button" variant="outline" size="sm" onClick={applyStockDelta}>
        Apply
      </Button>
      <Button type="button" variant={product.active ? 'destructive' : 'outline'} size="sm" onClick={toggleActive}>
        {product.active ? 'Deactivate' : 'Activate'}
      </Button>
      <span className="text-xs text-muted-foreground">{formatCurrency(product.price)}</span>
    </div>
  );
}
