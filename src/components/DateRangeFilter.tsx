import { useState } from "react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

const PRESETS = [
  { label: "Hoje", days: 0 },
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "Tudo", days: -1 },
];

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [activePreset, setActivePreset] = useState<number>(-1);

  const handlePreset = (days: number) => {
    setActivePreset(days);
    if (days === -1) {
      onChange({ from: undefined, to: undefined });
    } else {
      onChange({
        from: startOfDay(subDays(new Date(), days)),
        to: endOfDay(new Date()),
      });
    }
  };

  const handleCalendarSelect = (range: { from?: Date; to?: Date } | undefined) => {
    setActivePreset(-2); // custom
    onChange({
      from: range?.from,
      to: range?.to ? endOfDay(range.to) : range?.to,
    });
  };

  const label =
    value.from && value.to
      ? `${format(value.from, "dd/MM/yy", { locale: ptBR })} – ${format(value.to, "dd/MM/yy", { locale: ptBR })}`
      : "Período";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {PRESETS.map((p) => (
        <Button
          key={p.days}
          variant={activePreset === p.days ? "default" : "outline"}
          size="sm"
          onClick={() => handlePreset(p.days)}
        >
          {p.label}
        </Button>
      ))}

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={activePreset === -2 ? "default" : "outline"}
            size="sm"
            className={cn("gap-1.5", !value.from && "text-muted-foreground")}
          >
            <CalendarIcon size={14} />
            {activePreset === -2 && value.from ? label : "Personalizado"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={value.from ? { from: value.from, to: value.to } : undefined}
            onSelect={handleCalendarSelect}
            numberOfMonths={2}
            locale={ptBR}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
