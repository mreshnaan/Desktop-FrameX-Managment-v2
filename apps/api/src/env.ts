function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
  // Access-token lifetime. Defaults to the production value of 15 minutes;
  // overridable via env purely so tests can force a near-instant expiry
  // (e.g. JWT_ACCESS_TTL=3s) to exercise the refresh flow without waiting.
  JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL ?? '15m',
  PORT: Number(process.env.PORT ?? 4000),
};
