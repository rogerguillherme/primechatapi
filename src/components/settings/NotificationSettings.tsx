import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Bell, Volume2 } from "lucide-react";
import { toast } from "sonner";
import {
  useNotificationPrefs, type NotificationPrefs,
} from "@/hooks/use-notification-prefs";
import { useNotificationSound } from "@/hooks/use-notification-sound";

const ITENS: Array<{ key: keyof NotificationPrefs; titulo: string; ajuda: string }> = [
  {
    key: "new_lead",
    titulo: "Lead novo",
    ajuda: "Quando um contato entra na base. Vai para o dono da conta.",
  },
  {
    key: "assigned_to_me",
    titulo: "Lead atribuído a mim",
    ajuda: "Quando alguém passa um lead para você, ou a distribuição te escolhe.",
  },
  {
    key: "new_message",
    titulo: "Mensagem recebida",
    ajuda: "Nas conversas sob sua responsabilidade. Sem responsável, avisa o dono da conta.",
  },
];

export function NotificationSettings() {
  const { prefs, isLoading, save } = useNotificationPrefs();
  // Ligado à força aqui: o botão de testar precisa tocar mesmo com o som off.
  const tocar = useNotificationSound(true);

  const alterar = (key: keyof NotificationPrefs, valor: boolean) => {
    save.mutate(
      { [key]: valor } as Partial<NotificationPrefs>,
      { onError: (e: any) => toast.error(e?.message || "Não foi possível salvar") },
    );
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell size={18} className="text-primary" /> Notificações
        </CardTitle>
        <CardDescription>
          O que faz o sino tocar para você. Cada pessoa tem a sua configuração —
          o que você desliga aqui não afeta o resto da equipe.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-1">
        {ITENS.map((item) => (
          <div key={item.key} className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-0">
            <div className="min-w-0">
              <Label htmlFor={`notif-${item.key}`} className="text-sm">{item.titulo}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{item.ajuda}</p>
            </div>
            <Switch
              id={`notif-${item.key}`}
              checked={!!prefs[item.key]}
              disabled={isLoading || save.isPending}
              onCheckedChange={(v) => alterar(item.key, v)}
            />
          </div>
        ))}

        <div className="flex items-start justify-between gap-4 py-3 border-t border-border">
          <div className="min-w-0">
            <Label htmlFor="notif-sound" className="text-sm flex items-center gap-1.5">
              <Volume2 size={14} /> Tocar som
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              O navegador só libera som depois do primeiro clique na página — se não
              ouvir nada logo ao abrir, clique em qualquer lugar e teste de novo.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => tocar()}>Testar</Button>
            <Switch
              id="notif-sound"
              checked={!!prefs.sound}
              disabled={isLoading || save.isPending}
              onCheckedChange={(v) => alterar("sound", v)}
            />
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground pt-3">
          Mensagens seguidas da mesma conversa viram um aviso só, até você abrir. Sem
          isso, uma conversa movimentada enterraria todas as outras no sino.
        </p>
      </CardContent>
    </Card>
  );
}
