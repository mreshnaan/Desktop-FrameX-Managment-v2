import type { Response, NextFunction } from 'express';
import { hasAccess, type ViewKey } from '../shared/index';
import type { AuthedRequest } from './auth';

export function requireView(view: ViewKey) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !hasAccess(req.user.role, view)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
