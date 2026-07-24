import express from 'express';
import cors from 'cors';
import { env } from './env';
import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';

export const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth', authRouter);
app.use('/users', usersRouter);

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => console.log(`api listening on :${env.PORT}`));
}
