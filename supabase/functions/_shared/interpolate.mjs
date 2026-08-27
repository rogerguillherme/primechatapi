// Substituição de variáveis nas mensagens de fluxo.
//
// Compartilhado por whatsapp-cloud-webhook e flow-processor: os dois disparam
// mensagens de fluxo e precisam entender exatamente as mesmas variáveis.
//
// A versão anterior casava só /\{(\w+)\}/ — `\w` não inclui espaço, então
// `{Telefone do lead}` (o nome que a geração de fluxo por IA escreve) nunca era
// reconhecido e ia para o cliente literal, dentro do link. Aqui o nome da
// variável é normalizado antes da busca, então as formas humanas funcionam sem
// ninguém precisar reescrever fluxo já salvo.

const stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Nomes candidatos para uma variável escrita por humano ou por IA, do mais
 * literal para o mais reduzido. O primeiro que existir no mapa vence.
 */
export function variableCandidates(raw) {
  const out = [];
  const push = (v) => {
    if (v && !out.includes(v)) out.push(v);
  };

  // `{Telefone do lead | leadPhone}` — tenta os dois lados.
  for (const part of String(raw).split("|")) {
    const base = stripAccents(part)
      .trim()
      // camelCase -> snake_case, antes de baixar a caixa
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[\s.-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    if (!base) continue;

    push(base);
    // "telefone_do_lead" -> "telefone"
    push(base.replace(/_(do|da|de|dos|das)_(lead|cliente|contato|comprador|aluno)$/, ""));
    // "lead_phone" -> "phone"
    push(base.replace(/^(lead|cliente|contato|comprador)_/, ""));
  }
  return out;
}

/**
 * Troca {variavel} pelo valor. Variável desconhecida fica intacta — melhor o
 * operador ver `{sobrenome}` na conversa do que uma lacuna silenciosa.
 */
export function interpolate(text, vars) {
  if (!text) return text;
  return String(text)
    // Placeholders numerados de template ({{1}}) primeiro, para o padrão de
    // chave única abaixo não morder o miolo deles.
    .replace(/\{\{(\d+)\}\}/g, () => vars.nome || "")
    .replace(/\{([^{}]+)\}/g, (whole, raw) => {
      for (const key of variableCandidates(raw)) {
        if (vars[key] !== undefined && vars[key] !== "") return vars[key];
      }
      return whole;
    });
}
