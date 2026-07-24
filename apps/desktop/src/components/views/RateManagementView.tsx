import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { TimeRateSchema, FrameRateSchema, type TimeRateInput, type FrameRateInput } from '@/lib/shared';
import { useRates, type RateWithCategory } from '@/lib/hooks/useRates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';

type SetRateFn = (row: {
  categoryId: string;
  hourRate: number | null;
  halfRate: number | null;
  frameRate: number | null;
}) => Promise<void>;

export default function RateManagementView() {
  const { rates, setRate } = useRates();

  return (
    <div className="flex flex-col gap-4 p-4">
      {rates.map(row =>
        row.billingType === 'time' ? (
          <TimeRateCard key={row.categoryId} row={row} setRate={setRate} />
        ) : (
          <FrameRateCard key={row.categoryId} row={row} setRate={setRate} />
        )
      )}
    </div>
  );
}

function TimeRateCard({ row, setRate }: { row: RateWithCategory; setRate: SetRateFn }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TimeRateInput>({
    resolver: zodResolver(TimeRateSchema),
    defaultValues: { categoryId: row.categoryId, hour: row.hourRate ?? 0, half: row.halfRate ?? 0 },
  });

  async function onSubmit(data: TimeRateInput) {
    await setRate({
      categoryId: row.categoryId,
      hourRate: data.hour,
      halfRate: data.half,
      frameRate: null,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{row.categoryName}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup className="@md/field-group:flex-row @md/field-group:items-end">
            <Field className="@md/field-group:max-w-40">
              <FieldLabel htmlFor={`hour-${row.categoryId}`}>Rate per 60 min</FieldLabel>
              <Input
                id={`hour-${row.categoryId}`}
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
              <FieldLabel htmlFor={`half-${row.categoryId}`}>Rate per 30 min</FieldLabel>
              <Input
                id={`half-${row.categoryId}`}
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

function FrameRateCard({ row, setRate }: { row: RateWithCategory; setRate: SetRateFn }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FrameRateInput>({
    resolver: zodResolver(FrameRateSchema),
    defaultValues: { categoryId: row.categoryId, value: row.frameRate ?? 0 },
  });

  async function onSubmit(data: FrameRateInput) {
    await setRate({
      categoryId: row.categoryId,
      hourRate: null,
      halfRate: null,
      frameRate: data.value,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{row.categoryName}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-40">
          <Field>
            <FieldLabel htmlFor={`value-${row.categoryId}`}>Rate per frame</FieldLabel>
            <Input
              id={`value-${row.categoryId}`}
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
