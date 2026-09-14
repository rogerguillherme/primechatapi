import { useEffect, useRef, useState } from "react";
import { Loader2, Plug, QrCode } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  invokeEvolutionInstance, resolveQrToDataUrl, normalizePairingCode,
} from "@/lib/evolution-connect";

/**
 * Formulário de conexão Evolution API — nome, servidor e API key entram
 * aqui, sem precisar passar pela aba Configuração do Prime Chat. Mesma
 * edge function (evolution-instance) que já atende o resto do app.
 */
export function EvolutionConnectCard({ onConnected }: { onConnected: () => void }) {
  const [nome, setNome] = useState("");
  const [servidor, setServidor] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const handleConnect = async () => {
    if (!nome.trim()) {
      toast.error("Informe o nome da conta.");
      return;
    }
    setLoading(true);
    try {
      const data = await invokeEvolutionInstance({
        action: "create_and_connect",
        name: nome.trim(),
        serverUrl: servidor.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      });

      toast.success(data?.already_existed ? "Instância já existia — gerando QR…" : "Instância criada! Escaneie o QR.");

      if (data?.qr_code) {
        setQrImage(await resolveQrToDataUrl(String(data.qr_code)));
      }
      setPairingCode(normalizePairingCode(data?.pairing_code));

      if (data?.account_id) {
        stopPolling();
        pollRef.current = window.setInterval(async () => {
          try {
            const status = await invokeEvolutionInstance({ action: "status", account_id: data.account_id }, 1);
            if (String(status?.state) === "open") {
              stopPolling();
              toast.success("WhatsApp conectado com sucesso! 🎉");
              onConnected();
            }
          } catch {
            // Erro transitório de status não interrompe o polling.
          }
        }, 3000) as unknown as number;
      }
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <Plug size={18} className="text-primary" />
          <h2 className="font-semibold">Conectar WhatsApp (Evolution API)</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Conecte o número que vai gerenciar os grupos. Servidor e API key ficam em branco
          se a conta já tiver os secrets padrão configurados no backend.
        </p>

        {!qrImage && !pairingCode && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="evo-nome" className="text-xs">Nome da conta</Label>
              <Input id="evo-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: WhatsApp Grupos" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evo-servidor" className="text-xs">Servidor Evolution (URL)</Label>
              <Input id="evo-servidor" value={servidor} onChange={(e) => setServidor(e.target.value)} placeholder="https://sua-evolution.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evo-apikey" className="text-xs">API Key</Label>
              <Input id="evo-apikey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="••••••••" />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={handleConnect} disabled={loading} className="gap-2">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                Conectar
              </Button>
            </div>
          </div>
        )}

        {(qrImage || pairingCode) && (
          <div className="flex flex-col items-center gap-3 py-2">
            {qrImage && <img src={qrImage} alt="QR Code" className="w-56 h-56 rounded-lg border border-border" />}
            {pairingCode && (
              <p className="text-sm">
                Ou use o código de pareamento: <span className="font-mono font-bold">{pairingCode}</span>
              </p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <QrCode size={13} /> Escaneie no WhatsApp do número que vai conectar. Aguardando confirmação…
            </p>
            <Button
              variant="ghost" size="sm"
              onClick={() => { stopPolling(); setQrImage(null); setPairingCode(null); }}
            >
              Cancelar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
