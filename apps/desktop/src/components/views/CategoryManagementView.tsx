import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCategories } from '@/lib/hooks/useCategories';
import { commands } from '@/lib/tauri/commands';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ListSkeleton } from '@/components/ui/list-skeleton';

export default function CategoryManagementView() {
  const { categories, isLoading } = useCategories();
  const qc = useQueryClient();

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['categories'] });
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <NewCategoryCard onCreated={refresh} />
      {isLoading ? (
        <ListSkeleton />
      ) : (
        categories.map(category => (
          <Card key={category.id}>
            <CardHeader>
              <CardTitle>
                {category.name}
                <span className="ml-2 text-sm font-normal text-muted-foreground">({category.billingType})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <RenameCategoryForm
                categoryId={category.id}
                currentName={category.name}
                billingType={category.billingType}
                onRenamed={refresh}
              />
              <div className="flex flex-col gap-2">
                {category.stations.map(station => (
                  <RenameStationForm key={station.id} stationId={station.id} currentName={station.name} onRenamed={refresh} />
                ))}
              </div>
              <NewStationForm categoryId={category.id} onCreated={refresh} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function NewCategoryCard({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [billingType, setBillingType] = useState<'time' | 'frame'>('time');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await commands.createCategory(name.trim(), billingType);
      setName('');
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create category');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add category</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup className="@md/field-group:flex-row @md/field-group:items-end">
          <Field>
            <FieldLabel htmlFor="new-category-name">Name</FieldLabel>
            <Input id="new-category-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Foosball" />
          </Field>
          <Field className="@md/field-group:max-w-40">
            <FieldLabel htmlFor="new-category-billing">Billing</FieldLabel>
            <Select value={billingType} onValueChange={v => setBillingType(v as 'time' | 'frame')}>
              <SelectTrigger id="new-category-billing">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="time">By time</SelectItem>
                <SelectItem value="frame">By frame</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button type="button" disabled={submitting || !name.trim()} onClick={submit}>
            Add category
          </Button>
        </FieldGroup>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function RenameCategoryForm({
  categoryId,
  currentName,
  billingType,
  onRenamed,
}: {
  categoryId: string;
  currentName: string;
  billingType: string;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(currentName);

  async function commit() {
    if (!name.trim() || name === currentName) return;
    // billingType isn't editable in this UI, but update_category always
    // writes the full row -- pass the category's current value through so a
    // rename never silently blanks it out.
    await commands.updateCategory(categoryId, name.trim(), billingType);
    onRenamed();
  }

  return (
    <Field>
      <FieldLabel htmlFor={`category-name-${categoryId}`}>Category name</FieldLabel>
      <div className="flex gap-2">
        <Input id={`category-name-${categoryId}`} value={name} onChange={e => setName(e.target.value)} />
        <Button type="button" variant="outline" size="sm" onClick={commit} disabled={!name.trim() || name === currentName}>
          Save
        </Button>
      </div>
    </Field>
  );
}

function RenameStationForm({
  stationId,
  currentName,
  onRenamed,
}: {
  stationId: string;
  currentName: string;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(currentName);

  async function commit() {
    if (!name.trim() || name === currentName) return;
    await commands.updateStation(stationId, name.trim());
    onRenamed();
  }

  return (
    <div className="flex items-center gap-2">
      <Input value={name} onChange={e => setName(e.target.value)} className="max-w-48" aria-label="Station name" />
      <Button type="button" variant="outline" size="sm" onClick={commit} disabled={!name.trim() || name === currentName}>
        Save
      </Button>
    </div>
  );
}

function NewStationForm({ categoryId, onCreated }: { categoryId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await commands.createStation(categoryId, name.trim());
      setName('');
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="New station name"
        className="max-w-48"
        aria-label="New station name"
      />
      <Button type="button" variant="outline" size="sm" onClick={submit} disabled={submitting || !name.trim()}>
        + Add station
      </Button>
    </div>
  );
}
