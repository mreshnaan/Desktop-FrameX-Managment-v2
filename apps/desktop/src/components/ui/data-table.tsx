import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  isLoading?: boolean;
  loadingState?: ReactNode;
  emptyState?: ReactNode;
  onRowClick?: (row: TData) => void;
  rowClassName?: string;
}

export function DataTable<TData>({
  columns,
  data,
  isLoading,
  loadingState,
  emptyState,
  onRowClick,
  rowClassName,
}: DataTableProps<TData>) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  if (isLoading) return <>{loadingState ?? <p className="px-4 text-sm text-muted-foreground">Loading…</p>}</>;
  if (data.length === 0) return <>{emptyState ?? <p className="px-4 text-sm text-muted-foreground">No data</p>}</>;

  return (
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
          <TableRow
            key={row.id}
            className={rowClassName}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
          >
            {row.getVisibleCells().map(cell => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
