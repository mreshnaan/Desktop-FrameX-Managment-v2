import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import bcrypt from 'bcrypt';
import { app } from '../server';
import { prisma } from '../db';

// Everything else in src/tests/ mocks prisma -- these tests deliberately
// don't, so they exercise the real Express routes, real middleware chain,
// and real Postgres round-trip (schema drift, query correctness, JWT
// issuance/verification) that mocked unit tests structurally can't catch.
// Run with `pnpm test:integration`, not the default `pnpm test`.

const USERNAME = 'e2e-integration';
const PIN = '1234';
let baseUrl: string;
let server: Server;
let customerId: string;

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as { port: number };
  baseUrl = `http://localhost:${port}`;

  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'OWNER' } });
  const pinHash = await bcrypt.hash(PIN, 12);
  await prisma.user.upsert({
    where: { username: USERNAME },
    create: { username: USERNAME, pinHash, name: 'E2E Integration', roleId: role.id },
    update: { pinHash, roleId: role.id },
  });
});

afterAll(async () => {
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /auth/login', () => {
  it('rejects a wrong PIN', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, pin: '9999' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns an access token and the OWNER permission set for the right PIN', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, pin: PIN }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ accessToken: string; user: { permissions: string[] } }>(res);
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.user.permissions).toContain('userManagement');
  });
});

describe('authenticated routes', () => {
  let accessToken: string;

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, pin: PIN }),
    });
    ({ accessToken } = await json<{ accessToken: string }>(res));
  });

  it('rejects a request with no bearer token', async () => {
    const res = await fetch(`${baseUrl}/sync/pull`);
    expect(res.status).toBe(401);
  });

  it('lists the three seeded system roles', async () => {
    const res = await fetch(`${baseUrl}/roles`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const roles = await json<{ name: string; isSystem: boolean }[]>(res);
    const names = roles.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['OWNER', 'ADMIN', 'CASHIER']));
  });

  it('a pushed customer is retrievable via pull', async () => {
    customerId = crypto.randomUUID();
    const pushRes = await fetch(`${baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        entries: [
          {
            table: 'customers',
            op: 'upsert',
            id: customerId,
            payload: { id: customerId, name: 'E2E Integration Customer', phone: '' },
            clientUpdatedAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(pushRes.status).toBe(200);
    expect((await json<{ failed: unknown[] }>(pushRes)).failed).toEqual([]);

    const pullRes = await fetch(`${baseUrl}/sync/pull?since=2000-01-01T00:00:00.000Z`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(pullRes.status).toBe(200);
    const body = await json<{ customers: unknown[] }>(pullRes);
    expect(body.customers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: customerId, name: 'E2E Integration Customer' })]),
    );
  });
});
