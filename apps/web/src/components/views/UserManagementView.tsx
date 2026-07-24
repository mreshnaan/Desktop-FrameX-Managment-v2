import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  flexRender,
} from '@tanstack/react-table';
import { CreateUserSchema, ROLES, type CreateUserInput, type Role } from '@/lib/shared';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: Role;
}

const columnHelper = createColumnHelper<UserRow>();

const columns = [
  columnHelper.accessor('name', { header: 'Name' }),
  columnHelper.accessor('username', { header: 'Username' }),
  columnHelper.accessor('role', { header: 'Role' }),
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

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: { username: '', password: '', name: '', role: 'CASHIER' },
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

  const table = useReactTable({
    data: usersQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

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
                <FieldLabel htmlFor="user-password">Password</FieldLabel>
                <Input
                  id="user-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Password"
                  aria-invalid={!!errors.password}
                  {...register('password')}
                />
                <FieldError errors={errors.password ? [errors.password] : undefined} />
              </Field>
              <Field>
                <FieldLabel htmlFor="user-role">Role</FieldLabel>
                <Controller
                  name="role"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="user-role" aria-invalid={!!errors.role}>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map(role => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={errors.role ? [errors.role] : undefined} />
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
          {usersQuery.isLoading ? (
            <p className="px-4 text-sm text-muted-foreground">Loading users…</p>
          ) : !usersQuery.data || usersQuery.data.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map(headerGroup => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map(row => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
