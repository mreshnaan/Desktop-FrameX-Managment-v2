// Patches Express so a rejected async handler reaches the error middleware
// below instead of crashing the process -- must load before any router.
import 'express-async-errors';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { env } from './env';
import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';
import { rolesRouter } from './routes/roles.routes';
import { syncRouter } from './routes/sync.routes';
import { reportsRouter } from './routes/reports.routes';
import { sessionsRouter } from './routes/sessions.routes';
import { expensesRouter } from './routes/expenses.routes';
import { ordersRouter } from './routes/orders.routes';
import { logsRouter } from './routes/logs.routes';

export const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/roles', rolesRouter);
app.use('/sync', syncRouter);
app.use('/reports', reportsRouter);
app.use('/sessions', sessionsRouter);
app.use('/expenses', expensesRouter);
app.use('/orders', ordersRouter);
app.use('/', logsRouter);

// Backstop for any route with an unguarded input (e.g. reports.routes.ts's
// /monthly also builds a Date straight from a query param).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => console.log(`api listening on :${env.PORT}`));
}
