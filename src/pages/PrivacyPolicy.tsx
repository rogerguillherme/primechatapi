export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-3xl mx-auto space-y-6 text-sm leading-relaxed">
        <h1 className="text-2xl font-display font-bold mb-2">Política de Privacidade</h1>
        <p className="text-muted-foreground">Última atualização: 15/09/2026</p>

        <p>
          O Prime Chat é operado por <strong>ESTEVAO DIGITAL E VENDAS LTDA</strong>, inscrita no CNPJ sob o nº{" "}
          <strong>56.431.313/0001-59</strong>, com sede na Av. Brigadeiro Faria Lima, 1811, Conj. 115, CxPst 8006,
          Jardim Paulistano, São Paulo/SP, CEP 01.452-001 ("nós"). Esta política explica como coletamos, usamos e
          protegemos os dados de quem utiliza nossa plataforma.
        </p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">1. Dados que coletamos</h2>
          <p>
            Coletamos dados fornecidos por você ao criar conta (nome, e-mail, telefone) e dados de uso da plataforma,
            incluindo mensagens, contatos e integrações conectadas (WhatsApp Cloud API, Instagram e Meta Ads),
            necessários para o funcionamento do serviço.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">2. Como usamos os dados</h2>
          <p>
            Usamos os dados para operar o CRM, enviar e receber mensagens em seu nome através das contas que você
            conecta, gerar métricas de vendas e atendimento, e cumprir obrigações legais.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">3. Compartilhamento</h2>
          <p>
            Não vendemos seus dados. Compartilhamos informações apenas com provedores necessários à operação do
            serviço (ex: Meta/WhatsApp, Instagram, Supabase) e quando exigido por lei.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">4. Seus direitos</h2>
          <p>
            Você pode solicitar acesso, correção ou exclusão dos seus dados a qualquer momento, conforme a Lei Geral
            de Proteção de Dados (LGPD - Lei nº 13.709/2018).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">5. Contato</h2>
          <p>
            Dúvidas sobre esta política podem ser enviadas para{" "}
            <a href="mailto:estevaosz0602@gmail.com" className="underline">
              estevaosz0602@gmail.com
            </a>{" "}
            ou pelo telefone (51) 8300-4232.
          </p>
        </section>
      </div>
    </div>
  );
}
