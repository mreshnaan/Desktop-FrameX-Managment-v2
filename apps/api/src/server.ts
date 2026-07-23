import express from 'express';
import cors from 'cors';
import { env } from './env.js';

export const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => console.log(`api listening on :${env.PORT}`));
}
