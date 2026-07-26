import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { prisma } from '../db';

export const reportsRouter = Router();

reportsRouter.use(authenticate);

reportsRouter.get('/monthly', async (req, res) => {
  const startDate = String(req.query.startDate || '');
  const endDate = String(req.query.endDate || '');
  const startUtc = String(req.query.startUtc || '');
  const endUtc = String(req.query.endUtc || '');

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate required' });
  }

  const stations = await prisma.station.findMany({
    select: { id: true, categoryId: true },
  });
  const categoryByStationId = new Map(stations.map(s => [s.id, s.categoryId]));

  const sessionGroup = await prisma.session.groupBy({
    by: ['date', 'method', 'stationId'],
    where: {
      date: { gte: startDate, lte: endDate },
      deletedAt: null,
    },
    _sum: { amount: true },
  });

  const sessionMap = new Map<string, number>();
  for (const s of sessionGroup) {
    const categoryId = categoryByStationId.get(s.stationId);
    if (!categoryId) continue;
    const key = `${s.date}:${categoryId}:${s.method}`;
    sessionMap.set(key, (sessionMap.get(key) ?? 0) + (s._sum.amount ?? 0));
  }

  const sessionTotals = Array.from(sessionMap.entries()).map(([key, total]) => {
    const [date, categoryId, method] = key.split(':');
    return { date, categoryId, method, total };
  });

  const expenseGroup = await prisma.expense.groupBy({
    by: ['date', 'method'],
    where: {
      date: { gte: startDate, lte: endDate },
      deletedAt: null,
    },
    _sum: { amount: true },
  });

  const expenseTotals = expenseGroup.map(e => ({
    date: e.date,
    method: e.method,
    total: e._sum.amount ?? 0,
  }));

  const orderStart = startUtc ? new Date(startUtc) : new Date(startDate);
  const orderEnd = endUtc ? new Date(endUtc) : new Date(`${endDate}T23:59:59.999Z`);

  const orders = await prisma.order.findMany({
    where: {
      updatedAt: { gte: orderStart, lt: orderEnd },
      deletedAt: null,
    },
    include: {
      items: {
        include: {
          product: { select: { cost: true } },
        },
      },
    },
  });

  const cafeMap = new Map<string, { total: number; profit: number }>();
  for (const o of orders) {
    const date = o.updatedAt.toISOString().slice(0, 10);
    const key = `${date}:${o.method}`;
    const entry = cafeMap.get(key) ?? { total: 0, profit: 0 };
    entry.total += o.total;

    let orderProfit = 0;
    for (const item of o.items) {
      const cost = item.product?.cost ?? 0;
      orderProfit += item.lineTotal - cost * item.qty;
    }
    entry.profit += orderProfit;
    cafeMap.set(key, entry);
  }

  const cafeTotals = Array.from(cafeMap.entries()).map(([key, val]) => {
    const [date, method] = key.split(':');
    return { date, method, total: val.total, profit: val.profit };
  });

  return res.json({ sessionTotals, expenseTotals, cafeTotals });
});

// GET /reports/customer-balances -- one row per active customer's net credit balance.
reportsRouter.get('/customer-balances', async (_req, res) => {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });

  // Three aggregations: Credit sessions, Credit cafe orders, credit_entries
  const [sessionSums, orderSums, creditEntrySums] = await Promise.all([
    prisma.session.groupBy({
      by: ['customerId'],
      where: { method: 'Credit', customerId: { not: null }, deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.order.groupBy({
      by: ['customerId'],
      where: { method: 'Credit', customerId: { not: null }, deletedAt: null },
      _sum: { total: true },
    }),
    prisma.creditEntry.groupBy({
      by: ['customerId', 'type'],
      _sum: { amount: true },
    }),
  ]);

  const sessionMap = new Map(sessionSums.map(s => [s.customerId!, s._sum.amount ?? 0]));
  const orderMap   = new Map(orderSums.map(o => [o.customerId!, o._sum.total ?? 0]));

  const creditGivenMap    = new Map<string, number>();
  const paymentReceivedMap = new Map<string, number>();
  for (const e of creditEntrySums) {
    if (e.type === 'CREDIT_GIVEN')     creditGivenMap.set(e.customerId, e._sum.amount ?? 0);
    if (e.type === 'PAYMENT_RECEIVED') paymentReceivedMap.set(e.customerId, e._sum.amount ?? 0);
  }

  const balances: Record<string, number> = {};
  for (const c of customers) {
    balances[c.id] =
      (sessionMap.get(c.id) ?? 0) +
      (orderMap.get(c.id) ?? 0) +
      (creditGivenMap.get(c.id) ?? 0) -
      (paymentReceivedMap.get(c.id) ?? 0);
  }

  return res.json(balances);
});

// GET /reports/customer-credit-history/:customerId -- merged, date-sorted
// timeline (Credit sessions + credit_entries). Pre-sorted in JS since Prisma has no UNION.
reportsRouter.get('/customer-credit-history/:customerId', async (req, res) => {
  const { customerId } = req.params;

  const [sessions, entries] = await Promise.all([
    prisma.session.findMany({
      where: { customerId, method: 'Credit', deletedAt: null },
      select: { id: true, date: true, amount: true, updatedAt: true },
    }),
    prisma.creditEntry.findMany({
      where: { customerId },
      select: { id: true, date: true, type: true, amount: true, updatedAt: true },
    }),
  ]);

  // `date` is a plain calendar day, so same-day entries need updatedAt as a tiebreaker.
  const rows = [
    ...sessions.map(s => ({
      id: `session-${s.id}`,
      date: s.date,
      label: 'Table charge',
      amount: s.amount,
      direction: 'charge' as const,
      updatedAt: s.updatedAt,
    })),
    ...entries.map(e => ({
      id: `credit-${e.id}`,
      date: e.date,
      label: e.type === 'CREDIT_GIVEN' ? 'Credit given' : 'Payment received',
      amount: e.amount,
      direction: e.type === 'PAYMENT_RECEIVED' ? ('payment' as const) : ('charge' as const),
      updatedAt: e.updatedAt,
    })),
  ]
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
    })
    .map(({ updatedAt: _updatedAt, ...row }) => row);

  return res.json(rows);
});
