import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Settings2, Shuffle, Clock, CalendarClock } from "lucide-react";

export interface FlowSettings {
  variation_enabled: boolean;
  delay_min_seconds: number;
  delay_max_seconds: number;
  sending_window_enabled: boolean;
  sending_window_start: string; // "HH:MM" or "HH:MM:SS"
  sending_window_end: string;
  sending_window_timezone: string;
}

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  variation_enabled: false,
  delay_min_seconds: 30,
  delay_max_seconds: 90,
  sending_window_enabled: false,
  sending_window_start: "09:00",
  sending_window_end: "18:00",
  sending_window_timezone: "America/Sao_Paulo",
};

const toHHMM = (v: string) => (v?.length >= 5 ? v.slice(0, 5) : v || "00:00");

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: FlowSettings;
  onChange: (patch: Partial<FlowSettings>) => void;
}

export function FlowSettingsDrawer({ open, onOpenChange, settings, onChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings2 size={18} className="text-primary" />
            Configurações do Fluxo
          </SheetTitle>
          <SheetDescription className="text-xs">
            Aplicado a todos os passos. Pode ser sobrescrito em cada nó.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Variação de mensagens */}
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Shuffle size={16} className="text-primary mt-0.5" />
                <div>
                  <Label className="text-sm font-medium">Variar mensagens</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    Quando ativo, cada nó pode ter várias versões da mensagem e o sistema
                    escolhe uma aleatoriamente a cada envio (anti-ban).
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.variation_enabled}
                onCheckedChange={(v) => onChange({ variation_enabled: v })}
              />
            </div>
          </section>

          {/* Tempo entre envios */}
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-start gap-2">
              <Clock size={16} className="text-primary mt-0.5" />
              <div className="flex-1">
                <Label className="text-sm font-medium">Tempo entre envios</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  Delay aleatório (em segundos) entre cada mensagem do fluxo.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pl-6">
              <div className="space-y-1">
                <Label className="text-xs">Mín. (s)</Label>
                <Input
                  type="number"
                  min={0}
                  value={settings.delay_min_seconds}
                  onChange={(e) =>
                    onChange({ delay_min_seconds: Math.max(0, parseInt(e.target.value) || 0) })
                  }
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Máx. (s)</Label>
                <Input
                  type="number"
                  min={0}
                  value={settings.delay_max_seconds}
                  onChange={(e) =>
                    onChange({ delay_max_seconds: Math.max(0, parseInt(e.target.value) || 0) })
                  }
                  className="h-8 text-sm"
                />
              </div>
            </div>
            {settings.delay_min_seconds > settings.delay_max_seconds && (
              <p className="text-[11px] text-destructive pl-6">
                Mínimo não pode ser maior que máximo.
              </p>
            )}
          </section>

          {/* Janela horária */}
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <CalendarClock size={16} className="text-primary mt-0.5" />
                <div>
                  <Label className="text-sm font-medium">Janela horária</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    Restringe envios a um horário específico do dia. Fora da janela,
                    o fluxo aguarda o próximo horário válido.
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.sending_window_enabled}
                onCheckedChange={(v) => onChange({ sending_window_enabled: v })}
              />
            </div>
            {settings.sending_window_enabled && (
              <div className="space-y-3 pl-6">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Início</Label>
                    <Input
                      type="time"
                      value={toHHMM(settings.sending_window_start)}
                      onChange={(e) => onChange({ sending_window_start: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fim</Label>
                    <Input
                      type="time"
                      value={toHHMM(settings.sending_window_end)}
                      onChange={(e) => onChange({ sending_window_end: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fuso horário</Label>
                  <Input
                    value={settings.sending_window_timezone}
                    onChange={(e) => onChange({ sending_window_timezone: e.target.value })}
                    placeholder="America/Sao_Paulo"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
