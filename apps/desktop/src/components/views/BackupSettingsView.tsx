import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [restoredFilename, setRestoredFilename] = useState<string | null>(null);

  const backupsQuery = useQuery({ queryKey: ['backups'], queryFn: () => commands.listBackups() });
  const dirQuery = useQuery({ queryKey: ['backup-dir'], queryFn: () => commands.getBackupDir() });

  async function runBackup() {
    setBusy(true);
    setMessage(null);
    try {
      const info = await commands.backupNow();
      setMessage(`Backup created: ${info.filename}`);
      await qc.invalidateQueries({ queryKey: ['backups'] });
    } catch (e) {
      setMessage(e instanceof Error ? `Backup failed: ${e.message}` : 'Backup failed');
    } finally {
      setBusy(false);
    }
  }

  async function runRestore(filename: string) {
    setBusy(true);
    setMessage(null);
    try {
      await commands.restoreBackup(filename);
      setRestoredFilename(filename);
    } catch (e) {
      setMessage(e instanceof Error ? `Restore failed: ${e.message}` : 'Restore failed');
    } finally {
      setBusy(false);
    }
  }

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
          <Button type="button" disabled={busy} onClick={runBackup} className="self-start">
            Back up now
          </Button>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
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
              {backupsQuery.data.map((backup: BackupInfo) => (
                <div key={backup.filename} className="flex items-center justify-between rounded-lg border border-border p-2">
                  <div>
                    <p className="text-sm font-medium">{backup.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.sizeBytes)}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => runRestore(backup.filename)}>
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
