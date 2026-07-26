import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireView } from '../middleware/requireRole';
import { prisma } from '../db';

export const sessionsRouter = Router();
sessionsRouter.use(authenticate, requireView('dailySales'));

// GET /sessions?date=YYYY-MM-DD -- bounded to one day, unlike /sync/pull.
sessionsRouter.get('/', async (req, res) => {
  const date = String(req.query.date || '');
  if (!date) {
    return res.status(400).json({ error: 'date required' });
  }

  const sessions = await prisma.session.findMany({
    where: { date, deletedAt: null },
  });

  return res.json(sessions);
});
