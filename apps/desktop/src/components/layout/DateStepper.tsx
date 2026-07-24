import { WEEKDAYS, MONTHS, dateStrOf, parseDate, todayStr } from '@/lib/shared';
import { Button } from '@/components/ui/button';

interface DateStepperProps {
  date: string;
  onDateChange: (date: string) => void;
}

export default function DateStepper({ date, onDateChange }: DateStepperProps) {
  const d = parseDate(date);
  const label = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

  function step(deltaDays: number) {
    const next = parseDate(date);
    next.setDate(next.getDate() + deltaDays);
    onDateChange(dateStrOf(next));
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => step(-1)}>
          ‹
        </Button>
        <div className="min-w-56 text-center text-lg font-semibold">{label}</div>
        <Button variant="outline" size="icon" aria-label="Next day" onClick={() => step(1)}>
          ›
        </Button>
      </div>
      <Button variant="outline" onClick={() => onDateChange(todayStr())}>
        Today
      </Button>
    </div>
  );
}
