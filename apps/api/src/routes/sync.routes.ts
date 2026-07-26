import { Router } from 'express';
import { SyncPullQuerySchema, SyncPushSchema } from '../shared/index';
import { authenticate, type AuthedRequest } from '../middleware/auth';
import { applyPush, pullSince } from '../services/sync.service';

export const syncRouter = Router();
syncRouter.use(authenticate);

syncRouter.post('/push', async (req: AuthedRequest, res) => {
  const parsed = SyncPushSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  // applyPush() isolates each entry in its own transaction and reports
  // failures instead of throwing, so a bad entry can't wedge the whole batch.
  // The client doesn't yet consume `failed` per-entry -- follow-up item.
  const { failed } = await applyPush(parsed.data.entries, req.user?.sub);
  res.json({ ok: true, failed });
});

syncRouter.get('/pull', async (req: AuthedRequest, res) => {
  const parsed = SyncPullQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(await pullSince(parsed.data.since, req.user?.sub));
});
