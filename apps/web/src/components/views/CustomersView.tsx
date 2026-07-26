import {
  createColumnHelper,
  type ColumnDef,
} from '@tanstack/react-table';
import type { Customer } from '@/lib/shared';
import { useCustomers } from '@/lib/hooks/useCustomers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';

const columnHelper = createColumnHelper<Customer>();

const columns = [
  columnHelper.accessor('name', { header: 'Name' }),
  columnHelper.accessor('phone', {
    header: 'Phone',
    cell: info => info.getValue() || '—',
  }),
];

// Read-only: customers are added on the desktop app -- web only displays them.
export default function CustomersView() {
  const { customers } = useCustomers();

  return (
    <div className="flex flex-col gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Customers</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable
            columns={columns as ColumnDef<Customer>[]}
            data={customers}
            emptyState={<p className="px-4 text-sm text-muted-foreground">No customers yet.</p>}
          />
        </CardContent>
      </Card>
    </div>
  );
}
