"use client";

import { useState } from "react";
import { SubmitButton } from "@/app/submit-button";
import { PeriodRangeSelector } from "@/components/ui/period-range-selector";

export function BackfillPeriodFields({ today }: { today: string }) {
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);

  return (
    <>
      <PeriodRangeSelector
        inline
        today={today}
        maxDate={today}
        value={range}
        presets={[]}
        onApply={({ start, end }) => setRange({ start, end })}
      />
      <input type="hidden" name="since" value={range?.start ?? ""} />
      <input type="hidden" name="until" value={range?.end ?? ""} />
      <SubmitButton
        disabled={!range}
        className="self-start rounded-md border border-amber-600 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950"
        pendingChildren="Rodando backfill… pode levar alguns minutos"
      >
        Iniciar backfill histórico real
      </SubmitButton>
    </>
  );
}
