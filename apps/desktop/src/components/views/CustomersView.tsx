import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { CustomerDraftSchema, type Customer } from '@/lib/shared';
import { useCustomers } from '@/lib/hooks/useCustomers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import { DataTable } from '@/components/ui/data-table';

const columnHelper = createColumnHelper<Customer>();

export default function CustomersView() {
  const { customers, addCustomer, deleteCustomer } = useCustomers();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(CustomerDraftSchema),
    defaultValues: { name: '', phone: '' },
  });

  async function onSubmit(data: { name: string; phone?: string }) {
    await addCustomer({ name: data.name, phone: data.phone || '' });
    reset();
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', { header: 'Name' }),
      columnHelper.accessor('phone', {
        header: 'Phone',
        cell: info => info.getValue() || '—',
      }),
      columnHelper.display({
        id: 'actions',
        header: '—',
        cell: info => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Delete ${info.row.original.name}`}
            onClick={() => deleteCustomer(info.row.original.id)}
          >
            <Trash2 className="text-destructive" />
          </Button>
        ),
      }),
    ],
    [deleteCustomer]
  );

  return (
    <div className="flex flex-col gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Add customer</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <FieldGroup className="@md/field-group:flex-row @md/field-group:items-end">
              <Field>
                <FieldLabel htmlFor="customer-name">Name</FieldLabel>
                <Input
                  id="customer-name"
                  placeholder="Customer name"
                  aria-invalid={!!errors.name}
                  {...register('name')}
                />
                <FieldError errors={errors.name ? [errors.name] : undefined} />
              </Field>
              <Field>
                <FieldLabel htmlFor="customer-phone">Phone</FieldLabel>
                <Input
                  id="customer-phone"
                  placeholder="Phone (optional)"
                  aria-invalid={!!errors.phone}
                  {...register('phone')}
                />
                <FieldError errors={errors.phone ? [errors.phone] : undefined} />
              </Field>
            </FieldGroup>
            <Button type="submit" variant="outline" disabled={isSubmitting} className="self-start">
              Add customer
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customers</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable
            columns={columns as ColumnDef<Customer>[]}
            data={customers}
            emptyState={
              <p className="px-4 text-sm text-muted-foreground">
                No customers yet. Add a customer above to enable credit tracking.
              </p>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
