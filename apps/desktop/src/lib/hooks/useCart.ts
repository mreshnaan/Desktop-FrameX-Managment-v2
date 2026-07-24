import { useReducer } from 'react';
import type { ProductRow } from '../tauri/commands';

export interface CartLine {
  product: ProductRow;
  qty: number;
}

type CartState = CartLine[];

type CartAction =
  | { type: 'add'; product: ProductRow }
  | { type: 'remove'; productId: string }
  | { type: 'setQty'; productId: string; qty: number }
  | { type: 'clear' };

// Pure reducer, client-only (not persisted) -- matches FrameX's
// cartReducer.ts. The cart never touches SQLite; it's just staged state
// until checkout() calls create_order.
export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const existing = state.find(l => l.product.id === action.product.id);
      if (existing) {
        return state.map(l => (l.product.id === action.product.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...state, { product: action.product, qty: 1 }];
    }
    case 'remove':
      return state.filter(l => l.product.id !== action.productId);
    case 'setQty':
      if (action.qty <= 0) return state.filter(l => l.product.id !== action.productId);
      return state.map(l => (l.product.id === action.productId ? { ...l, qty: action.qty } : l));
    case 'clear':
      return [];
  }
}

export function useCart() {
  const [lines, dispatch] = useReducer(cartReducer, [] as CartState);
  const total = lines.reduce((sum, l) => sum + l.product.price * l.qty, 0);

  return {
    lines,
    total,
    addToCart: (product: ProductRow) => dispatch({ type: 'add', product }),
    removeFromCart: (productId: string) => dispatch({ type: 'remove', productId }),
    setQty: (productId: string, qty: number) => dispatch({ type: 'setQty', productId, qty }),
    clearCart: () => dispatch({ type: 'clear' }),
  };
}
