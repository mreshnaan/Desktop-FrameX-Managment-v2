import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
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

  const createCategory = useMutation({
    mutationFn: (input: { name: string; billingType: string }) =>
      commands.createCategory(input.name, input.billingType),
  });

  async function submit() {
    if (!name.trim()) return;
    await createCategory.mutateAsync({ name: name.trim(), billingType });
    setName('');
    onCreated();
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
          <Button type="button" disabled={createCategory.isPending || !name.trim()} onClick={submit}>
            Add category
          </Button>
        </FieldGroup>
        {createCategory.error && <p className="mt-2 text-sm text-destructive">{createCategory.error.message}</p>}
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

  const updateCategory = useMutation({
    mutationFn: (input: { name: string; billingType: string }) =>
      commands.updateCategory(categoryId, input.name, input.billingType),
  });

  async function commit() {
    if (!name.trim() || name === currentName) return;
    // billingType isn't editable in this UI, but update_category always
    // writes the full row -- pass the category's current value through so a
    // rename never silently blanks it out.
    await updateCategory.mutateAsync({ name: name.trim(), billingType });
    onRenamed();
  }

  return (
    <Field>
      <FieldLabel htmlFor={`category-name-${categoryId}`}>Category name</FieldLabel>
      <div className="flex gap-2">
        <Input id={`category-name-${categoryId}`} value={name} onChange={e => setName(e.target.value)} />
        <Button type="button" variant="outline" size="sm" onClick={commit} disabled={!name.trim() || name === currentName || updateCategory.isPending}>
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

  const updateStation = useMutation({
    mutationFn: (name: string) => commands.updateStation(stationId, name),
  });

  async function commit() {
    if (!name.trim() || name === currentName) return;
    await updateStation.mutateAsync(name.trim());
    onRenamed();
  }

  return (
    <div className="flex items-center gap-2">
      <Input value={name} onChange={e => setName(e.target.value)} className="max-w-48" aria-label="Station name" />
      <Button type="button" variant="outline" size="sm" onClick={commit} disabled={!name.trim() || name === currentName || updateStation.isPending}>
        Save
      </Button>
    </div>
  );
}

function NewStationForm({ categoryId, onCreated }: { categoryId: string; onCreated: () => void }) {
  const [name, setName] = useState('');

  const createStation = useMutation({
    mutationFn: (name: string) => commands.createStation(categoryId, name),
  });

  async function submit() {
    if (!name.trim()) return;
    await createStation.mutateAsync(name.trim());
    setName('');
    onCreated();
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
      <Button type="button" variant="outline" size="sm" onClick={submit} disabled={createStation.isPending || !name.trim()}>
        + Add station
      </Button>
    </div>
  );
}
