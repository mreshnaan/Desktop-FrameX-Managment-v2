import { Router } from 'express';
import { SyncPushSchema } from '../shared/index';
import { authenticate } from '../middleware/auth';
import { applyPush, pullSince } from '../services/sync.service';

export const syncRouter = Router();
syncRouter.use(authenticate);

syncRouter.post('/push', async (req, res) => {
  const parsed = SyncPushSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await applyPush(parsed.data.entries);
  res.json({ ok: true });
});

syncRouter.get('/pull', async (req, res) => {
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  res.json(await pullSince(since));
});
