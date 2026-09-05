import { useState } from "react";
import { MessageCircleQuestion, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

const helpTopics = [
  {
    q: "Como usar variáveis nas mensagens?",
    a: "Use {nome} para o primeiro nome do lead e {codigo} para o código dos metadados. Exemplo: 'Olá {nome}, seu código é {codigo}'.",
  },
  {
    q: "Como funciona o delay no fluxo?",
    a: "O nó de Delay pausa a execução pelo tempo definido (em minutos). Após o tempo, o próximo passo é executado automaticamente.",
  },
  {
    q: "Como enviar botões interativos?",
    a: "Adicione um nó de 'Botões Interativos' ao fluxo. Você pode definir até 3 botões com títulos de até 20 caracteres.",
  },
  {
    q: "Como enviar um link (CTA)?",
    a: "Use o nó 'Botão com Link'. Defina o texto do botão e a URL. A mensagem será enviada com um botão clicável.",
  },
  {
    q: "Posso usar templates do WhatsApp?",
    a: "Sim! No nó de Mensagem, selecione um template cadastrado. Os parâmetros como {nome} serão preenchidos automaticamente.",
  },
  {
    q: "O que é o nó de Condição?",
    a: "O nó de Condição aguarda a resposta do lead (ex: clique em botão). Dependendo da resposta, o fluxo segue por caminhos diferentes.",
  },
];

export function HelpChatBubble() {
  const [open, setOpen] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<number | null>(null);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-80 max-h-[480px] bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-t-2xl">
            <MessageCircleQuestion size={20} />
            <span className="font-semibold text-sm flex-1">Ajuda com Disparos</span>
            <button onClick={() => { setOpen(false); setSelectedTopic(null); }} className="hover:opacity-80">
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {selectedTopic === null ? (
              <>
                <p className="text-xs text-muted-foreground px-1 pb-1">
                  Escolha um tópico para saber mais:
                </p>
                {helpTopics.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedTopic(i)}
                    className="w-full text-left px-3 py-2.5 rounded-lg text-sm bg-muted/50 hover:bg-muted transition-colors text-foreground"
                  >
                    {t.q}
                  </button>
                ))}
              </>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={() => setSelectedTopic(null)}
                  className="text-xs text-primary hover:underline"
                >
                  ← Voltar aos tópicos
                </button>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm font-medium text-foreground mb-2">
                    {helpTopics[selectedTopic].q}
                  </p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {helpTopics[selectedTopic].a}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating button */}
      <Button
        onClick={() => setOpen(!open)}
        size="icon"
        className="h-14 w-14 rounded-full shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {open ? <X size={24} /> : <MessageCircleQuestion size={24} />}
      </Button>
    </div>
  );
}
