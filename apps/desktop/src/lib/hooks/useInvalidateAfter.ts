import { useQueryClient } from '@tanstack/react-query';

// Every write-capable hook repeats "await the mutation, then invalidate the
// queries it affects" -- needs useQueryClient() (itself a hook), so unlike
// groupBy() this is a genuine custom hook, not a plain function.
export function useInvalidateAfter(...queryKeys: unknown[][]) {
  const qc = useQueryClient();

  return async function runAndInvalidate<T>(action: () => Promise<T>): Promise<T> {
    const result = await action();
    await Promise.all(queryKeys.map(queryKey => qc.invalidateQueries({ queryKey })));
    return result;
  };
}
