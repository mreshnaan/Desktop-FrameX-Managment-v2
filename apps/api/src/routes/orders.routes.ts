import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { prisma } from '../db';

export const ordersRouter = Router();
ordersRouter.use(authenticate);

// GET /orders?startUtc=<ISO>&endUtc=<ISO> -- bounded by UTC instant, unlike
// /sync/pull. Orders have no `date` column; updatedAt is the UTC instant the
// order belongs to (see apps/desktop's list_orders_between for why this
// can't be a plain date filter).
ordersRouter.get('/', async (req, res) => {
  const startUtc = String(req.query.startUtc || '');
  const endUtc = String(req.query.endUtc || '');
  if (!startUtc || !endUtc) {
    return res.status(400).json({ error: 'startUtc and endUtc required' });
  }

  const orders = await prisma.order.findMany({
    where: {
      updatedAt: { gte: new Date(startUtc), lt: new Date(endUtc) },
      deletedAt: null,
    },
  });

  const orderIds = orders.map(o => o.id);
  const orderItems = orderIds.length > 0
    ? await prisma.orderItem.findMany({ where: { orderId: { in: orderIds } } })
    : [];

  return res.json({ orders, orderItems });
});
