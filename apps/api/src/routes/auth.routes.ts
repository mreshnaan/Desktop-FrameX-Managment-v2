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
    // Only this exact message means a genuine auth failure -- anything else
    // is an infrastructure problem, logged server-side and returned as 500.
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
