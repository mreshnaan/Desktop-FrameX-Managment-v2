import { useQueryClient } from '@tanstack/react-query';

// Every write-capable hook repeats "await the mutation, then invalidate the
// queries it affects" -- needs useQueryClient() (itself a hook), so unlike
// groupBy() this is a genuine custom hook, not a plain function.
//
// Takes an array of query keys (not variadic) -- a variadic signature lets
// `(['a'], ['b'])` (two keys) and `(['a', 'b'])` (one two-segment key)
// both typecheck with different meanings, which is exactly the mistake
// this hook exists to prevent at its call sites.
export function useInvalidateAfter(queryKeys: unknown[][]) {
  const qc = useQueryClient();

  return async function runAndInvalidate<T>(action: () => Promise<T>): Promise<T> {
    const result = await action();
    await Promise.all(queryKeys.map(queryKey => qc.invalidateQueries({ queryKey })));
    return result;
  };
}
