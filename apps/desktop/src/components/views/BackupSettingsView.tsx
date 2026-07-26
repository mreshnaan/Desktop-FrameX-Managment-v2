import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { commands, type BackupInfo } from '@/lib/tauri/commands';
import { branding } from '@/config/branding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListSkeleton } from '@/components/ui/list-skeleton';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupSettingsView() {
  const qc = useQueryClient();
  const [restoredFilename, setRestoredFilename] = useState<string | null>(null);

  const backupsQuery = useQuery({ queryKey: ['backups'], queryFn: () => commands.listBackups() });
  const dirQuery = useQuery({ queryKey: ['backup-dir'], queryFn: () => commands.getBackupDir() });

  const backup = useMutation({
    mutationFn: () => commands.backupNow(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });

  const restore = useMutation({
    mutationFn: (filename: string) => commands.restoreBackup(filename),
    onSuccess: (_data, filename) => setRestoredFilename(filename),
  });

  if (restoredFilename) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Restore complete</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Restored from <span className="font-medium text-foreground">{restoredFilename}</span>. Close and
              reopen {branding.appName} for the restored data to take effect.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {dirQuery.data && (
            <p className="text-sm text-muted-foreground">Backups are stored at {dirQuery.data}</p>
          )}
          <Button type="button" disabled={backup.isPending} onClick={() => backup.mutate()} className="self-start">
            Back up now
          </Button>
          {backup.isSuccess && <p className="text-sm text-muted-foreground">Backup created: {backup.data.filename}</p>}
          {backup.error && <p className="text-sm text-destructive">Backup failed: {backup.error.message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Restore</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {backupsQuery.isLoading ? (
            <ListSkeleton />
          ) : !backupsQuery.data || backupsQuery.data.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No backups yet.</p>
          ) : (
            <div className="flex flex-col gap-2 px-4">
              {backupsQuery.data.map((backupInfo: BackupInfo) => (
                <div key={backupInfo.filename} className="flex items-center justify-between rounded-lg border border-border p-2">
                  <div>
                    <p className="text-sm font-medium">{backupInfo.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(backupInfo.createdAt).toLocaleString()} · {formatBytes(backupInfo.sizeBytes)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={backup.isPending || restore.isPending}
                    onClick={() => restore.mutate(backupInfo.filename)}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
          {restore.error && <p className="mt-2 px-4 text-sm text-destructive">Restore failed: {restore.error.message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
