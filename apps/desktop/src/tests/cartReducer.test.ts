import { describe, it, expect } from 'vitest';
import { cartReducer, type CartLine } from '../lib/hooks/useCart';
import type { ProductRow } from '../lib/tauri/commands';

function makeProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'p1',
    categoryId: 'c1',
    name: 'Cola',
    price: 50,
    cost: null,
    stockQty: 10,
    lowStockThreshold: 2,
    barcode: null,
    active: true,
    updatedAt: '2026-07-25T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('cartReducer', () => {
  it('adds a new product as a line with quantity 1', () => {
    const product = makeProduct();
    const state = cartReducer([], { type: 'add', product });

    expect(state).toEqual([{ product, qty: 1 }]);
  });

  it('adding the same product again increments its quantity instead of duplicating the line', () => {
    const product = makeProduct();
    const first = cartReducer([], { type: 'add', product });
    const second = cartReducer(first, { type: 'add', product });

    expect(second).toHaveLength(1);
    expect(second[0].qty).toBe(2);
  });

  it('adding a different product creates a separate line', () => {
    const a = makeProduct({ id: 'p1' });
    const b = makeProduct({ id: 'p2', name: 'Chips' });
    const state = cartReducer(cartReducer([], { type: 'add', product: a }), { type: 'add', product: b });

    expect(state).toHaveLength(2);
  });

  it('removes a line entirely', () => {
    const product = makeProduct();
    const withLine = cartReducer([], { type: 'add', product });

    const state = cartReducer(withLine, { type: 'remove', productId: product.id });

    expect(state).toEqual([]);
  });

  it('setQty updates the quantity of an existing line', () => {
    const product = makeProduct();
    const withLine = cartReducer([], { type: 'add', product });

    const state = cartReducer(withLine, { type: 'setQty', productId: product.id, qty: 5 });

    expect(state[0].qty).toBe(5);
  });

  it('setQty to zero or below removes the line, matching the "remove" action', () => {
    const product = makeProduct();
    const withLine = cartReducer([], { type: 'add', product });

    const state = cartReducer(withLine, { type: 'setQty', productId: product.id, qty: 0 });

    expect(state).toEqual([]);
  });

  it('clear empties the cart regardless of prior state', () => {
    const lines: CartLine[] = [{ product: makeProduct(), qty: 3 }];

    const state = cartReducer(lines, { type: 'clear' });

    expect(state).toEqual([]);
  });

  it('is a pure function: the input array is never mutated', () => {
    const product = makeProduct();
    const original: CartLine[] = [{ product, qty: 1 }];
    const originalCopy = [...original];

    cartReducer(original, { type: 'setQty', productId: product.id, qty: 9 });

    expect(original).toEqual(originalCopy);
  });
});
