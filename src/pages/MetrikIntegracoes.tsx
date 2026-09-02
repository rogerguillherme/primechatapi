import { lazy, Suspense } from "react";
import { Plug } from "lucide-react";

import { useFavicon } from "@/hooks/use-favicon";
import { Card, TituloPagina } from "@/components/metrics/ui";

const WebhookEndpoints = lazy(() =>
  import("@/components/WebhookEndpoints").then((m) => ({ default: m.WebhookEndpoints })),
);

/**
 * Integrações: por onde as vendas entram.
 *
 * Nada de webhook foi escrito aqui. `webhook_endpoints` guarda um token por
 * tipo de evento, `custom-webhook/{token}` recebe, e WebhookEndpoints já é a
 * tela que gera e testa essas URLs — tudo isso já existia no Prime Chat.
 * Um webhook por plataforma seria treze funções fazendo a mesma coisa.
 *
 * A grade abaixo é referência: diz o que já foi visto funcionando, para quem
 * está configurando saber se precisa mapear campo ou se é só colar a URL.
 */

/** Plataformas com entrada de venda já testada por webhook genérico. */
const PLATAFORMAS = [
  "Monetizze", "Applyfy", "Last Link", "Hubla",
  "Perfect Pay", "Eduzz", "Kiwify", "Hotmart",
  "Cakto", "Kirvano", "Ticto", "Assiny", "HyperCash",
];

export default function MetrikIntegracoes() {
  useFavicon("/metrik-favicon.svg");

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Integrações"
        sub="As vendas entram por webhook — uma URL por tipo de evento"
      />

      <Card>
        <div className="flex items-center gap-2">
          <Plug size={15} className="text-primary" />
          <h2 className="font-semibold">Plataformas suportadas</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {PLATAFORMAS.length} integrações
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Todas usam a mesma URL: cole no painel de webhooks da plataforma e escolha o evento
          correspondente. Não há configuração por plataforma.
        </p>

        <div className="mt-4 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {PLATAFORMAS.map((p) => (
            <div
              key={p}
              className="metrik-card metrik-card-hover rounded-lg px-3 py-2.5 text-center"
            >
              <p className="text-sm font-medium truncate">{p}</p>
              <span className="mt-1 inline-block rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary">
                Disponível
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Carregando endpoints…</p>}
      >
        <WebhookEndpoints />
      </Suspense>
    </div>
  );
}
