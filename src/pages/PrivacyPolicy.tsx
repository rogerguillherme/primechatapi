import { Link } from "react-router-dom";
import { ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />
            Voltar
          </Link>
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-primary" />
            <span className="font-display font-semibold">Prime Chat</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <article className="prose prose-slate dark:prose-invert max-w-none">
          <h1 className="text-4xl font-display font-bold mb-2">Política de Privacidade</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Última atualização: 23 de maio de 2026
          </p>

          <section className="space-y-6 text-foreground leading-relaxed">
            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">1. Introdução</h2>
              <p>
                A Prime Chat ("nós", "nosso") respeita sua privacidade e está comprometida em proteger
                os dados pessoais que você compartilha conosco. Esta Política de Privacidade descreve como
                coletamos, usamos, armazenamos e protegemos suas informações ao utilizar nossa plataforma
                de comunicação integrada com WhatsApp Cloud API, Instagram e Facebook.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">2. Dados que Coletamos</h2>
              <p>Coletamos os seguintes tipos de informação:</p>
              <ul className="list-disc pl-6 space-y-2 mt-3">
                <li><strong>Dados de cadastro:</strong> nome, e-mail e credenciais de acesso.</li>
                <li><strong>Dados de integração Meta:</strong> tokens de acesso, IDs de WABA, IDs de números de telefone, IDs de páginas do Facebook e contas do Instagram autorizados via OAuth oficial da Meta.</li>
                <li><strong>Dados de contatos (leads):</strong> nome, telefone, e-mail e metadados que você importar ou que cheguem via integrações.</li>
                <li><strong>Mensagens:</strong> conteúdo de mensagens enviadas e recebidas via WhatsApp, Instagram e Facebook, incluindo mídia e templates.</li>
                <li><strong>Dados técnicos:</strong> logs de webhooks, eventos de envio, status de entrega, métricas de qualidade e dados de auditoria de segurança.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">3. Como Usamos seus Dados</h2>
              <ul className="list-disc pl-6 space-y-2 mt-3">
                <li>Operar e manter a plataforma e suas integrações com Meta.</li>
                <li>Enviar e receber mensagens em seu nome via WhatsApp Cloud API, Instagram e Facebook.</li>
                <li>Executar automações, fluxos e disparos configurados por você.</li>
                <li>Gerar relatórios, métricas e dashboards.</li>
                <li>Garantir a segurança, prevenir fraudes e detectar uso indevido.</li>
                <li>Cumprir obrigações legais e regulatórias.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">4. Integração com a Meta Platforms</h2>
              <p>
                A Prime Chat utiliza as APIs oficiais da Meta (WhatsApp Business Platform, Instagram Graph API
                e Facebook Login) por meio do fluxo oficial de <strong>Embedded Signup</strong> e OAuth.
                Os tokens de acesso são armazenados de forma segura e usados exclusivamente para realizar
                as ações solicitadas por você. Nenhum dado é compartilhado com terceiros não autorizados.
              </p>
              <p className="mt-3">
                O uso da plataforma também está sujeito às políticas da Meta, incluindo a
                <a href="https://www.whatsapp.com/legal/business-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline mx-1">Política Comercial do WhatsApp</a>
                e os <a href="https://developers.facebook.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline mx-1">Termos da Plataforma Meta</a>.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">5. Armazenamento e Segurança</h2>
              <p>
                Todos os dados são armazenados em infraestrutura segura, com criptografia em trânsito (HTTPS/TLS)
                e em repouso. Aplicamos políticas estritas de Row-Level Security (RLS) para garantir o isolamento
                entre contas. Tokens sensíveis ficam restritos ao backend e nunca são expostos ao navegador.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">6. Compartilhamento de Dados</h2>
              <p>
                Não vendemos, alugamos ou compartilhamos seus dados pessoais com terceiros para fins de marketing.
                Compartilhamos informações apenas com:
              </p>
              <ul className="list-disc pl-6 space-y-2 mt-3">
                <li>Meta Platforms, exclusivamente para entregar mensagens e operar as integrações.</li>
                <li>Provedores de infraestrutura (hospedagem, banco de dados) sob contrato de confidencialidade.</li>
                <li>Autoridades públicas, quando legalmente exigido.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">7. Retenção</h2>
              <p>
                Mantemos seus dados enquanto sua conta estiver ativa ou pelo tempo necessário para cumprir
                obrigações legais. Você pode solicitar a exclusão dos seus dados a qualquer momento.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">8. Seus Direitos (LGPD)</h2>
              <p>Você tem direito de:</p>
              <ul className="list-disc pl-6 space-y-2 mt-3">
                <li>Acessar seus dados pessoais.</li>
                <li>Corrigir dados incompletos ou desatualizados.</li>
                <li>Solicitar a anonimização, bloqueio ou eliminação de dados.</li>
                <li>Solicitar a portabilidade dos dados.</li>
                <li>Revogar o consentimento a qualquer momento.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">9. Cookies</h2>
              <p>
                Utilizamos cookies estritamente necessários para autenticação e funcionamento da plataforma.
                Não utilizamos cookies de rastreamento de terceiros para fins publicitários.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">10. Alterações nesta Política</h2>
              <p>
                Podemos atualizar esta Política periodicamente. Mudanças significativas serão comunicadas
                por e-mail ou através de aviso na plataforma.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-display font-semibold mt-8 mb-3">11. Contato</h2>
              <p>
                Para dúvidas, solicitações ou exercer seus direitos, entre em contato pelo e-mail:
                <a href="mailto:privacidade@primechat.com" className="text-primary hover:underline ml-1">
                  privacidade@primechat.com
                </a>
              </p>
            </div>
          </section>

          <div className="mt-12 pt-8 border-t border-border">
            <Link to="/">
              <Button variant="outline">
                <ArrowLeft size={16} />
                Voltar para o início
              </Button>
            </Link>
          </div>
        </article>
      </main>
    </div>
  );
}
