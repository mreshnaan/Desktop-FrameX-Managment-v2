export function toFieldErrors(
  error: { message?: string } | string | null | undefined,
): Array<{ message?: string }> | undefined {
  if (!error) return undefined;
  return [typeof error === 'string' ? { message: error } : error];
}
