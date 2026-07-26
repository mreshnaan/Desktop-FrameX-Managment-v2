import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { CreateUserSchema, type CreateUserInput } from '@/lib/shared';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PinInput } from '@/components/ui/pin-input';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/components/ui/data-table';

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: { id: string; name: string };
}

interface RoleRow {
  id: string;
  name: string;
  isSystem: boolean;
}

const columnHelper = createColumnHelper<UserRow>();

const columns = [
  columnHelper.accessor('name', { header: 'Name' }),
  columnHelper.accessor('username', { header: 'Username' }),
  columnHelper.accessor(row => row.role.name, { id: 'role', header: 'Role' }),
];

export default function UserManagementView() {
  const { state } = useAuth();
  const accessToken = state.accessToken;
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<UserRow[]>('/users', { accessToken }),
  });
  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiFetch<RoleRow[]>('/roles', { accessToken }),
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: { username: '', pin: '', name: '', roleId: '' },
  });

  async function onSubmit(data: CreateUserInput) {
    setFormError(null);
    try {
      await apiFetch<UserRow>('/users', {
        method: 'POST',
        body: JSON.stringify(data),
        accessToken,
      });
      reset();
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create user');
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Add user</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <FieldGroup className="@md/field-group:flex-row @md/field-group:items-end">
              <Field>
                <FieldLabel htmlFor="user-name">Name</FieldLabel>
                <Input
                  id="user-name"
                  placeholder="Full name"
                  aria-invalid={!!errors.name}
                  {...register('name')}
                />
                <FieldError errors={errors.name ? [errors.name] : undefined} />
              </Field>
              <Field>
                <FieldLabel htmlFor="user-username">Username</FieldLabel>
                <Input
                  id="user-username"
                  type="text"
                  autoComplete="username"
                  placeholder="username"
                  aria-invalid={!!errors.username}
                  {...register('username')}
                />
                <FieldError errors={errors.username ? [errors.username] : undefined} />
              </Field>
              <Field>
                <FieldLabel htmlFor="user-pin">PIN</FieldLabel>
                <Controller
                  name="pin"
                  control={control}
                  render={({ field }) => (
                    <PinInput id="user-pin" value={field.value} onChange={field.onChange} aria-invalid={!!errors.pin} />
                  )}
                />
                <FieldError errors={errors.pin ? [errors.pin] : undefined} />
              </Field>
              <Field>
                <FieldLabel htmlFor="user-role">Role</FieldLabel>
                <Controller
                  name="roleId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="user-role" aria-invalid={!!errors.roleId}>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {(rolesQuery.data ?? []).map(role => (
                          <SelectItem key={role.id} value={role.id} label={role.name}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={errors.roleId ? [errors.roleId] : undefined} />
              </Field>
            </FieldGroup>
            {formError && (
              <p role="alert" className="text-sm font-normal text-destructive">
                {formError}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting} className="self-start">
              Create user
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable
            columns={columns as ColumnDef<UserRow>[]}
            data={usersQuery.data ?? []}
            isLoading={usersQuery.isLoading}
            loadingState={<ListSkeleton />}
            emptyState={<p className="px-4 text-sm text-muted-foreground">No users yet.</p>}
          />
        </CardContent>
      </Card>
    </div>
  );
}
