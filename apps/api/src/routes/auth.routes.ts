import { Router } from 'express';
import { LoginSchema } from '../shared/index';
import { login } from '../services/auth.service';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await login(parsed.data.email, parsed.data.password);
    res.json(result);
  } catch {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});
