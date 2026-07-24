import type { Response, NextFunction } from 'express';
import { hasPermission, type PermissionKey } from '../shared/index';
import type { AuthedRequest } from './auth';

export function requireView(permission: PermissionKey) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !hasPermission(req.user.permissions, permission)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
