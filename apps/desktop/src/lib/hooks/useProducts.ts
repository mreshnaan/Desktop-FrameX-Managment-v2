import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type ProductRow } from '../tauri/commands';

export function useProducts() {
  const qc = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ['product-categories'], queryFn: () => commands.listProductCategories() });
  const productsQuery = useQuery({ queryKey: ['products'], queryFn: () => commands.listProducts() });

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['product-categories'] });
    await qc.invalidateQueries({ queryKey: ['products'] });
  }

  async function addCategory(name: string) {
    await commands.createProductCategory(name);
    await refresh();
  }

  async function addProduct(input: {
    categoryId: string;
    name: string;
    price: number;
    cost: number | null;
    lowStockThreshold: number;
    barcode: string | null;
  }) {
    await commands.createProduct(
      input.categoryId, input.name, input.price, input.cost, input.lowStockThreshold, input.barcode,
    );
    await refresh();
  }

  async function updateProduct(input: {
    id: string;
    name: string;
    price: number;
    cost: number | null;
    lowStockThreshold: number;
    barcode: string | null;
    active: boolean;
  }) {
    await commands.updateProduct(
      input.id, input.name, input.price, input.cost, input.lowStockThreshold, input.barcode, input.active,
    );
    await refresh();
  }

  async function adjustStock(productId: string, delta: number, reason: string, note: string | null) {
    await commands.adjustStock(productId, delta, reason, note);
    await refresh();
  }

  return {
    categories: categoriesQuery.data ?? [],
    products: productsQuery.data ?? [],
    isLoading: categoriesQuery.isLoading || productsQuery.isLoading,
    addCategory, addProduct, updateProduct, adjustStock,
  };
}

export function productsByCategory(products: ProductRow[], categoryId: string): ProductRow[] {
  return products.filter(p => p.categoryId === categoryId && p.active);
}
