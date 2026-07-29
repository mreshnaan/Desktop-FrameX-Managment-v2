import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  OfferDraftSchema,
  toFieldErrors,
  type OfferDraft,
} from '@/lib/shared';
import { useOffers } from '@/lib/hooks/useOffers';
import { useCategories } from '@/lib/hooks/useCategories';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { OfferRow, OfferInput } from '@/lib/tauri/commands';

const WEEKDAY_OPTIONS = [
  { code: 'mon', label: 'Mon' }, { code: 'tue', label: 'Tue' }, { code: 'wed', label: 'Wed' },
  { code: 'thu', label: 'Thu' }, { code: 'fri', label: 'Fri' }, { code: 'sat', label: 'Sat' }, { code: 'sun', label: 'Sun' },
];

export default function OfferManagementView() {
  const { offers, updateOffer } = useOffers();
  const { categories } = useCategories();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OfferRow | null>(null);

  function openCreate() {
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(offer: OfferRow) {
    setEditing(offer);
    setShowForm(true);
  }

  async function toggleActive(offer: OfferRow) {
    await updateOffer.mutateAsync({ id: offer.id, input: { ...toInput(offer), active: !offer.active } });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Offers</h1>
        <Button type="button" onClick={openCreate}>+ New offer</Button>
      </div>

      {offers.length === 0 && <p className="text-sm text-muted-foreground">No offers yet.</p>}

      <div className="flex flex-col gap-3">
        {offers.map(offer => (
          <Card key={offer.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{offer.name}</CardTitle>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(offer)}>Edit</Button>
                <Button
                  type="button"
                  variant={offer.active ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => toggleActive(offer)}
                >
                  {offer.active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {offer.appliesToAllCategories
                ? 'All categories'
                : (offer.categoryIds ?? '').split(',').map(id => categories.find(c => c.id === id)?.name ?? id).join(', ')}
            </CardContent>
          </Card>
        ))}
      </div>

      {showForm && (
        <OfferForm
          initial={editing}
          onSaved={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function toInput(offer: OfferRow): OfferInput {
  const { id: _id, updatedAt: _updatedAt, ...input } = offer;
  return input;
}

function OfferForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: OfferRow | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { addOffer, updateOffer } = useOffers();
  const { categories } = useCategories();
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<OfferDraft>({
    resolver: zodResolver(OfferDraftSchema),
    defaultValues: initial ?? {
      name: '',
      active: true,
      appliesToAllCategories: true,
      categoryIds: null,
      days: null,
      startTime: null,
      endTime: null,
      startDate: null,
      endDate: null,
      minDurationMinutes: null,
      minGameCount: null,
      effectType: 'extraTime',
      effectValue: 0,
    },
  });

  const appliesToAllCategories = watch('appliesToAllCategories');
  const selectedDays = new Set((watch('days') ?? '').split(',').filter(Boolean));
  const selectedCategoryIds = new Set((watch('categoryIds') ?? '').split(',').filter(Boolean));

  async function onSubmit(data: OfferDraft) {
    const input: OfferInput = { ...data };
    if (initial) {
      await updateOffer.mutateAsync({ id: initial.id, input });
    } else {
      await addOffer.mutateAsync(input);
    }
    onSaved();
  }

  return (
    <Card>
      <CardHeader><CardTitle>{initial ? 'Edit offer' : 'New offer'}</CardTitle></CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="offer-name">Name</FieldLabel>
            <Input id="offer-name" {...register('name')} aria-invalid={!!toFieldErrors(errors.name)} />
            <FieldError errors={toFieldErrors(errors.name)} />
          </Field>

          <Field>
            <FieldLabel>Categories</FieldLabel>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register('appliesToAllCategories')} />
              All categories
            </label>
            {!appliesToAllCategories && (
              <Controller
                name="categoryIds"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-wrap gap-3">
                    {categories.map(c => (
                      <label key={c.id} className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedCategoryIds.has(c.id)}
                          onChange={e => {
                            const next = new Set(selectedCategoryIds);
                            if (e.target.checked) next.add(c.id); else next.delete(c.id);
                            field.onChange(next.size > 0 ? Array.from(next).join(',') : null);
                          }}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                )}
              />
            )}
            <FieldError errors={toFieldErrors(errors.categoryIds)} />
          </Field>

          <Field>
            <FieldLabel>Days (leave all unchecked for every day)</FieldLabel>
            <Controller
              name="days"
              control={control}
              render={({ field }) => (
                <div className="flex flex-wrap gap-3">
                  {WEEKDAY_OPTIONS.map(d => (
                    <label key={d.code} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedDays.has(d.code)}
                        onChange={e => {
                          const next = new Set(selectedDays);
                          if (e.target.checked) next.add(d.code); else next.delete(d.code);
                          field.onChange(next.size > 0 ? Array.from(next).join(',') : null);
                        }}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              )}
            />
          </Field>

          <Field>
            <FieldLabel>Time window (optional)</FieldLabel>
            <div className="flex gap-2">
              <Input type="time" {...register('startTime')} aria-label="Start time" />
              <Input type="time" {...register('endTime')} aria-label="End time" />
            </div>
          </Field>

          <Field>
            <FieldLabel>Date range (optional, for limited-time promos)</FieldLabel>
            <div className="flex gap-2">
              <Input type="date" {...register('startDate')} aria-label="Start date" />
              <Input type="date" {...register('endDate')} aria-label="End date" />
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="offer-min-duration">Minimum duration (minutes, time-billed categories)</FieldLabel>
            <Input id="offer-min-duration" type="number" {...register('minDurationMinutes')} />
          </Field>

          <Field>
            <FieldLabel htmlFor="offer-min-game-count">Minimum game count (frame-billed categories)</FieldLabel>
            <Input id="offer-min-game-count" type="number" {...register('minGameCount')} />
          </Field>

          <Field>
            <FieldLabel>Effect</FieldLabel>
            <Controller
              name="effectType"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={v => field.onChange(v ?? 'extraTime')}>
                  <SelectTrigger aria-label="Effect type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extraTime">Extra free time (minutes)</SelectItem>
                    <SelectItem value="percentOff">Percent off</SelectItem>
                    <SelectItem value="flatOff">Flat amount off</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <Input type="number" {...register('effectValue')} aria-label="Effect value" />
            <FieldError errors={toFieldErrors(errors.effectValue)} />
          </Field>

          <div className="flex gap-2">
            <Button type="button" onClick={handleSubmit(onSubmit)}>Save</Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
