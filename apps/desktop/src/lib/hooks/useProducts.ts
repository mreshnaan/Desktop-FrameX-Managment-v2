import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type ProductRow } from '../tauri/commands';

export function useProducts() {
  const qc = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ['product-categories'], queryFn: () => commands.listProductCategories() });
  const productsQuery = useQuery({ queryKey: ['products'], queryFn: () => commands.listProducts() });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['product-categories'] });
    qc.invalidateQueries({ queryKey: ['products'] });
  }

  const addCategory = useMutation({
    mutationFn: (name: string) => commands.createProductCategory(name),
    onSuccess: invalidate,
  });

  const addProduct = useMutation({
    mutationFn: (input: {
      categoryId: string;
      name: string;
      price: number;
      cost: number | null;
      lowStockThreshold: number;
      barcode: string | null;
    }) =>
      commands.createProduct(
        input.categoryId, input.name, input.price, input.cost, input.lowStockThreshold, input.barcode,
      ),
    onSuccess: invalidate,
  });

  const updateProduct = useMutation({
    mutationFn: (input: {
      id: string;
      name: string;
      price: number;
      cost: number | null;
      lowStockThreshold: number;
      barcode: string | null;
      active: boolean;
    }) =>
      commands.updateProduct(
        input.id, input.name, input.price, input.cost, input.lowStockThreshold, input.barcode, input.active,
      ),
    onSuccess: invalidate,
  });

  const adjustStock = useMutation({
    mutationFn: (input: { productId: string; delta: number; reason: string; note: string | null }) =>
      commands.adjustStock(input.productId, input.delta, input.reason, input.note),
    onSuccess: invalidate,
  });

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
