// Must be required before any router is defined -- it patches Express's
// route/layer handling so a rejected promise from an `async (req, res) => {}`
// handler is forwarded to next(err) instead of going unhandled. Express 4
// itself never awaits (or attaches a .catch to) an async handler's returned
// promise, so without this an uncaught rejection (e.g. a
// PrismaClientValidationError from a malformed date passed straight into a
// `where` clause) bypasses the error middleware below entirely and, under
// Node's default --unhandled-rejections=throw, crashes the whole process.
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

// Generic error handler -- backstop for this route and any other route with
// a similar unguarded input (e.g. reports.routes.ts's /monthly also builds a
// `new Date(...)` straight from a query param). Thanks to express-async-errors
// above, an async handler's thrown/rejected error lands here instead of
// crashing the process; logs it and responds 500 instead of leaving the
// request hanging or the client unresponded to.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => console.log(`api listening on :${env.PORT}`));
}
