// Single grouping pass -- O(n) -- instead of re-filtering the same array
// once per key on every render (e.g. `categories.map(c => items.filter(i =>
// i.categoryId === c.id))`), which is O(n * number of keys).
export function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}
