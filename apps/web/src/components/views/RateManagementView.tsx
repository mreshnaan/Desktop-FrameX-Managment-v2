import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CATEGORIES,
  TimeRateSchema,
  FrameRateSchema,
  type TimeRateInput,
  type FrameRateInput,
} from '@cue-room/shared';
import { useRates } from '@/lib/hooks/useRates';
import type { RateRow } from '@/lib/db/dexie';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';

type SetRateFn = (row: RateRow) => Promise<void>;

export default function RateManagementView() {
  const { rates, setRate } = useRates();

  return (
    <div className="flex flex-col gap-4 p-4">
      {rates.map(row => {
        const category = CATEGORIES.find(c => c.name === row.category);
        if (!category) return null;
        return category.billing === 'time' ? (
          <TimeRateCard key={row.category} row={row} setRate={setRate} />
        ) : (
          <FrameRateCard key={row.category} row={row} setRate={setRate} />
        );
      })}
    </div>
  );
}

function TimeRateCard({ row, setRate }: { row: RateRow; setRate: SetRateFn }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TimeRateInput>({
    resolver: zodResolver(TimeRateSchema),
    defaultValues: { category: row.category, hour: row.hour ?? 0, half: row.half ?? 0 },
  });

  async function onSubmit(data: TimeRateInput) {
    await setRate({
      category: row.category,
      hour: data.hour,
      half: data.half,
      value: null,
      updatedAt: row.updatedAt,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{row.category}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup className="@md/field-group:flex-row @md/field-group:items-end">
            <Field className="@md/field-group:max-w-40">
              <FieldLabel htmlFor={`hour-${row.category}`}>Rate per 60 min</FieldLabel>
              <Input
                id={`hour-${row.category}`}
                type="number"
                min={0}
                step={1}
                aria-invalid={!!errors.hour}
                {...register('hour')}
                onBlur={handleSubmit(onSubmit)}
              />
              <FieldError errors={errors.hour ? [errors.hour] : undefined} />
            </Field>
            <Field className="@md/field-group:max-w-40">
              <FieldLabel htmlFor={`half-${row.category}`}>Rate per 30 min</FieldLabel>
              <Input
                id={`half-${row.category}`}
                type="number"
                min={0}
                step={1}
                aria-invalid={!!errors.half}
                {...register('half')}
                onBlur={handleSubmit(onSubmit)}
              />
              <FieldError errors={errors.half ? [errors.half] : undefined} />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function FrameRateCard({ row, setRate }: { row: RateRow; setRate: SetRateFn }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FrameRateInput>({
    resolver: zodResolver(FrameRateSchema),
    defaultValues: { category: row.category, value: row.value ?? 0 },
  });

  async function onSubmit(data: FrameRateInput) {
    await setRate({
      category: row.category,
      hour: null,
      half: null,
      value: data.value,
      updatedAt: row.updatedAt,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{row.category}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-40">
          <Field>
            <FieldLabel htmlFor={`value-${row.category}`}>Rate per frame</FieldLabel>
            <Input
              id={`value-${row.category}`}
              type="number"
              min={0}
              step={1}
              aria-invalid={!!errors.value}
              {...register('value')}
              onBlur={handleSubmit(onSubmit)}
            />
            <FieldError errors={errors.value ? [errors.value] : undefined} />
          </Field>
        </form>
      </CardContent>
    </Card>
  );
}
