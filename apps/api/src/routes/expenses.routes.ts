import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { prisma } from '../db';

export const expensesRouter = Router();
expensesRouter.use(authenticate);

// GET /expenses?date=YYYY-MM-DD -- bounded to one day, unlike /sync/pull.
expensesRouter.get('/', async (req, res) => {
  const date = String(req.query.date || '');
  if (!date) {
    return res.status(400).json({ error: 'date required' });
  }

  const expenses = await prisma.expense.findMany({
    where: { date, deletedAt: null },
  });

  return res.json(expenses);
});
