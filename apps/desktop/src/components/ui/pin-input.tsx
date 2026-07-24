import { useRef } from 'react';
import { cn } from '@/lib/utils';

interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  autoFocus?: boolean;
  'aria-invalid'?: boolean;
}

// A 4-digit PIN entry: a visually hidden numeric input captures keystrokes
// (so it works with a physical keyboard, a barcode-scanner-style numeric
// pad, or an on-screen keyboard) while 4 dot indicators show progress --
// matches FrameX's PinKeypad component.
export function PinInput({ value, onChange, id, autoFocus, ...rest }: PinInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="relative flex cursor-text items-center justify-center gap-4 rounded-md border border-input bg-transparent py-3"
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        {...rest}
      />
      {[0, 1, 2, 3].map((i) => {
        const filled = i < value.length;
        const active = i === value.length;
        return (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              'h-4 w-4 rounded-full border-2 border-foreground/40 transition-colors',
              filled && 'border-foreground bg-foreground',
              active && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
            )}
          />
        );
      })}
    </div>
  );
}
