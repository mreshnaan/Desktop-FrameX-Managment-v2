import type { Response, NextFunction } from 'express';
import { hasAccess, type ViewKey } from '@cue-room/shared';
import type { AuthedRequest } from './auth.js';

export function requireView(view: ViewKey) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !hasAccess(req.user.role, view)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
