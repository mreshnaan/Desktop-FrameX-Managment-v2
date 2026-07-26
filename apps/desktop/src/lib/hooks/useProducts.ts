import { useQuery } from '@tanstack/react-query';
import { commands, type ProductRow } from '../tauri/commands';
import { useInvalidateAfter } from './useInvalidateAfter';

export function useProducts() {
  const invalidate = useInvalidateAfter([['product-categories'], ['products']]);
  const categoriesQuery = useQuery({ queryKey: ['product-categories'], queryFn: () => commands.listProductCategories() });
  const productsQuery = useQuery({ queryKey: ['products'], queryFn: () => commands.listProducts() });

  async function addCategory(name: string) {
    await invalidate(() => commands.createProductCategory(name));
  }

  async function addProduct(input: {
    categoryId: string;
    name: string;
    price: number;
    cost: number | null;
    lowStockThreshold: number;
    barcode: string | null;
  }) {
    await invalidate(() => commands.createProduct(
      input.categoryId, input.name, input.price, input.cost, input.lowStockThreshold, input.barcode,
    ));
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
    await invalidate(() => commands.updateProduct(
      input.id, input.name, input.price, input.cost, input.lowStockThreshold, input.barcode, input.active,
    ));
  }

  async function adjustStock(productId: string, delta: number, reason: string, note: string | null) {
    await invalidate(() => commands.adjustStock(productId, delta, reason, note));
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
