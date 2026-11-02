import { formatQty, MAX_DAY_QTY } from '@/domain/household';

import { Icon } from './kit';

/** − 1.5 L +. Values in hundredths of a unit (the shared domain's quantities). */
export function Stepper({
  value,
  step,
  unit,
  min = 0,
  max = MAX_DAY_QTY,
  label,
  onChange,
}: {
  value: number;
  step: number;
  unit: string;
  min?: number;
  max?: number;
  /** Spoken name, e.g. "Milk today". */
  label: string;
  onChange: (next: number) => void;
}) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Less ${label}`}
        disabled={value <= min}
        onClick={() => set(value - step)}
      >
        <Icon name="minus" size={18} />
      </button>
      <output aria-live="polite">
        {formatQty(value)} {unit}
      </output>
      <button
        type="button"
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => set(value + step)}
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}
