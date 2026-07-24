import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate } from '../middleware/auth';
import { requireView } from '../middleware/requireRole';

export const rolesRouter = Router();
rolesRouter.use(authenticate, requireView('roleManagement'));

const roleInclude = { permissions: { include: { permission: true } } } as const;

function serializeRole(role: {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: { permission: { id: string; key: string; label: string } }[];
}) {
  return {
    id: role.id,
    name: role.name,
    isSystem: role.isSystem,
    permissions: role.permissions.map((rp) => rp.permission),
  };
}

rolesRouter.get('/', async (_req, res) => {
  const roles = await prisma.role.findMany({ include: roleInclude, orderBy: { name: 'asc' } });
  res.json(roles.map(serializeRole));
});

rolesRouter.get('/permissions', async (_req, res) => {
  const permissions = await prisma.permission.findMany({ orderBy: { label: 'asc' } });
  res.json(permissions);
});

const RoleInputSchema = z.object({
  name: z.string().min(1, 'Role name is required'),
  permissionIds: z.array(z.string()).default([]),
});

rolesRouter.post('/', async (req, res) => {
  const parsed = RoleInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const role = await prisma.role.create({
      data: {
        name: parsed.data.name,
        isSystem: false,
        permissions: { create: parsed.data.permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: roleInclude,
    });
    res.status(201).json(serializeRole(role));
  } catch {
    res.status(400).json({ error: 'Could not create role -- check the name is unique and permission ids are valid' });
  }
});

rolesRouter.patch('/:id', async (req, res) => {
  const parsed = RoleInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }
  if (existing.isSystem) {
    res.status(403).json({ error: 'System roles (OWNER/ADMIN/CASHIER) cannot be edited' });
    return;
  }
  try {
    const role = await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: existing.id } });
      return tx.role.update({
        where: { id: existing.id },
        data: {
          name: parsed.data.name,
          permissions: { create: parsed.data.permissionIds.map((permissionId) => ({ permissionId })) },
        },
        include: roleInclude,
      });
    });
    res.json(serializeRole(role));
  } catch {
    res.status(400).json({ error: 'Could not update role -- check the name is unique and permission ids are valid' });
  }
});

rolesRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }
  if (existing.isSystem) {
    res.status(403).json({ error: 'System roles (OWNER/ADMIN/CASHIER) cannot be deleted' });
    return;
  }
  try {
    await prisma.role.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch {
    // FK RESTRICT on User.roleId -- this role is still assigned to at least one user.
    res.status(409).json({ error: 'Cannot delete a role that is still assigned to users' });
  }
});
