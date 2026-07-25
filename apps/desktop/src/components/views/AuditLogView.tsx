import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 25;

interface ActivityLogEntry {
  id: string;
  userName: string | null;
  action: string;
  tableName: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

interface SyncLogEntry {
  id: string;
  userName: string | null;
  direction: string;
  entryCount: number;
  failedCount: number;
  errorSummary: string | null;
  createdAt: string;
}

interface Page<T> {
  entries: T[];
  total: number;
  page: number;
  pageSize: number;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function AuditLogView() {
  const [tab, setTab] = useState<'activity' | 'sync'>('activity');

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <Button type="button" variant={tab === 'activity' ? 'default' : 'outline'} size="sm" onClick={() => setTab('activity')}>
          Activity Log
        </Button>
        <Button type="button" variant={tab === 'sync' ? 'default' : 'outline'} size="sm" onClick={() => setTab('sync')}>
          Sync Log
        </Button>
      </div>
      {tab === 'activity' ? <ActivityLogTable /> : <SyncLogTable />}
    </div>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between px-4 py-2 text-sm text-muted-foreground">
      <span>
        Page {page} of {totalPages} ({total} total)
      </span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

function ActivityLogTable() {
  const { state } = useAuth();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['activity-logs', page],
    queryFn: () =>
      apiFetch<Page<ActivityLogEntry>>(`/activity-logs?page=${page}&pageSize=${PAGE_SIZE}`, {
        accessToken: state.accessToken,
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Log</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {query.isLoading ? (
          <ListSkeleton />
        ) : !query.data || query.data.entries.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.entries.map(entry => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatWhen(entry.createdAt)}</TableCell>
                    <TableCell>{entry.userName ?? 'Unknown'}</TableCell>
                    <TableCell>{entry.summary}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={page} total={query.data.total} onPage={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SyncLogTable() {
  const { state } = useAuth();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['sync-logs', page],
    queryFn: () =>
      apiFetch<Page<SyncLogEntry>>(`/sync-logs?page=${page}&pageSize=${PAGE_SIZE}`, {
        accessToken: state.accessToken,
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync Log</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {query.isLoading ? (
          <ListSkeleton />
        ) : !query.data || query.data.entries.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">No sync activity recorded yet.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Device / User</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.entries.map(entry => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatWhen(entry.createdAt)}</TableCell>
                    <TableCell>{entry.userName ?? 'Unknown'}</TableCell>
                    <TableCell className="capitalize">{entry.direction}</TableCell>
                    <TableCell>{entry.entryCount}</TableCell>
                    <TableCell>
                      {entry.failedCount > 0 ? (
                        <span className="text-destructive" title={entry.errorSummary ?? undefined}>
                          {entry.failedCount}
                        </span>
                      ) : (
                        0
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={page} total={query.data.total} onPage={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
