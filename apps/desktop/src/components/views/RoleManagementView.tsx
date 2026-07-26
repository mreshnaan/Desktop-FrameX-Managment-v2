import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { PERMISSION_KEYS } from '@/lib/shared';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { ListSkeleton } from '@/components/ui/list-skeleton';

interface PermissionRow {
  id: string;
  key: string;
  label: string;
}

interface RoleRow {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: PermissionRow[];
}

export default function RoleManagementView() {
  const { state } = useAuth();
  const accessToken = state.accessToken;
  const qc = useQueryClient();

  const rolesQuery = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => apiFetch<RoleRow[]>('/roles', { accessToken }),
  });

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['admin-roles'] });
    await qc.invalidateQueries({ queryKey: ['roles'] });
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <NewRoleCard onCreated={refresh} />
      {rolesQuery.isLoading ? (
        <ListSkeleton />
      ) : (
        (rolesQuery.data ?? []).map(role => (
          <RoleCard key={role.id} role={role} onChanged={refresh} />
        ))
      )}
    </div>
  );
}

function PermissionCheckboxes({
  selected,
  onChange,
  disabled,
}: {
  selected: Set<string>;
  onChange: (key: string, checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {PERMISSION_KEYS.map(p => (
        <label key={p.key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.has(p.key)}
            disabled={disabled}
            onChange={e => onChange(p.key, e.target.checked)}
          />
          {p.label}
        </label>
      ))}
    </div>
  );
}

function NewRoleCard({ onCreated }: { onCreated: () => void }) {
  const { state } = useAuth();
  const accessToken = state.accessToken;
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // permissionIds must be real Permission row ids, not keys -- fetch once so
  // we can map the checked keys to the ids the api expects.
  const permissionsQuery = useQuery({
    queryKey: ['admin-permissions'],
    queryFn: () => apiFetch<{ id: string; key: string }[]>('/roles/permissions', { accessToken }),
  });

  const createRole = useMutation({
    mutationFn: (input: { name: string; permissionIds: string[] }) =>
      apiFetch('/roles', { method: 'POST', accessToken, body: JSON.stringify(input) }),
  });

  function toggle(key: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function submit() {
    if (!name.trim()) return;
    const permissionIds = (permissionsQuery.data ?? [])
      .filter(p => selected.has(p.key))
      .map(p => p.id);
    await createRole.mutateAsync({ name: name.trim(), permissionIds });
    setName('');
    setSelected(new Set());
    onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add role</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="new-role-name">Role name</FieldLabel>
          <Input id="new-role-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Shift Supervisor" />
        </Field>
        <PermissionCheckboxes selected={selected} onChange={toggle} />
        {createRole.error && <p className="text-sm text-destructive">{createRole.error.message}</p>}
        <Button type="button" className="self-start" disabled={createRole.isPending || !name.trim()} onClick={submit}>
          Create role
        </Button>
      </CardContent>
    </Card>
  );
}

function RoleCard({ role, onChanged }: { role: RoleRow; onChanged: () => void }) {
  const { state } = useAuth();
  const accessToken = state.accessToken;
  const [name, setName] = useState(role.name);
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions.map(p => p.key)));

  const permissionsQuery = useQuery({
    queryKey: ['admin-permissions'],
    queryFn: () => apiFetch<{ id: string; key: string }[]>('/roles/permissions', { accessToken }),
  });

  const updateRole = useMutation({
    mutationFn: (input: { name: string; permissionIds: string[] }) =>
      apiFetch(`/roles/${role.id}`, { method: 'PATCH', accessToken, body: JSON.stringify(input) }),
  });

  const deleteRole = useMutation({
    mutationFn: () => apiFetch(`/roles/${role.id}`, { method: 'DELETE', accessToken }),
  });

  function toggle(key: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function save() {
    const permissionIds = (permissionsQuery.data ?? [])
      .filter(p => selected.has(p.key))
      .map(p => p.id);
    await updateRole.mutateAsync({ name: name.trim(), permissionIds });
    onChanged();
  }

  async function remove() {
    await deleteRole.mutateAsync();
    onChanged();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          {role.name}
          {role.isSystem && <span className="ml-2 text-sm font-normal text-muted-foreground">(system role)</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor={`role-name-${role.id}`}>Role name</FieldLabel>
          <Input
            id={`role-name-${role.id}`}
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={role.isSystem}
          />
        </Field>
        <PermissionCheckboxes selected={selected} onChange={toggle} disabled={role.isSystem} />
        {(updateRole.error || deleteRole.error) && (
          <p className="text-sm text-destructive">{(updateRole.error ?? deleteRole.error)?.message}</p>
        )}
        {!role.isSystem && (
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={save} disabled={updateRole.isPending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={remove} disabled={deleteRole.isPending}>
              Delete role
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
