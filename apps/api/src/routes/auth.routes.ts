import { Router } from 'express';
import { LoginSchema } from '../shared/index';
import { login, refreshToken } from '../services/auth.service';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await login(parsed.data.username, parsed.data.pin);
    res.json(result);
  } catch (err) {
    // login() only throws this exact message for a genuine auth failure (unknown
    // username or wrong PIN) -- see auth.service.ts. Anything else (DB outage,
    // an unexpected exception, etc.) is a real infrastructure problem and must
    // not be reported to the client as "your credentials are wrong". We log it
    // server-side and return 500 without leaking internal error details.
    if (err instanceof Error && err.message === 'Invalid credentials') {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    console.error('Unexpected error during login:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

authRouter.post('/refresh', async (req, res) => {
  const token = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  if (typeof token !== 'string' || token.length === 0) {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }
  try {
    const result = await refreshToken(token);
    res.json(result);
  } catch {
    // Expired/invalid/tampered refresh token, or a user that no longer exists.
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});
