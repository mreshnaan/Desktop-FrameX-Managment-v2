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
  // A malformed/bad entry from a buggy or malicious client must not be able to
  // wedge this endpoint (or that client's outbox) forever: applyPush() isolates
  // each entry in its own transaction and reports failures instead of throwing,
  // so we always respond 200 once the batch has been processed -- `failed` lets
  // the caller tell "this specific entry is permanently bad" apart from "the
  // whole push failed, retry everything". Consuming this per-entry failure list
  // on the client (apps/web's syncEngine.ts) is intentionally left as a
  // follow-up; today it still treats any non-empty response as full success.
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
