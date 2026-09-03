/**
 * Leitura de planilha de vendas (Hubla, Applyfy, Kiwify, Hotmart, Perfect Pay).
 *
 * Fica isolada aqui — sem React, sem Supabase — porque é o tipo de lógica cujo
 * erro não aparece na tela: o valor entra como 1,23 em vez de 1234,00 e ninguém
 * confere. `salesImport.test.ts` cobre normalização de telefone, conversão de
 * valor em formato brasileiro e a decisão novo/atualiza/ignora.
 *
 * As duas regras que NÃO podem afrouxar:
 *  - telefone normalizado igual ao do hubla-webhook, senão a importação cria
 *    lead duplicado para quem já conversa no WhatsApp;
 *  - `external_order_id` é a chave de idempotência (UNIQUE em orders).
 *    Reimportar o mesmo mês tem de atualizar, nunca duplicar nem estourar.
 */

export type FieldKey =
  | "external_order_id"
  | "name"
  | "phone"
  | "email"
  | "product"
  | "amount"
  | "status"
  | "payment_method"
  | "date"
  // O líquido e as parcelas: o CSV de checkout costuma trazer só o líquido e
  // o valor da parcela, e o bruto é parcela × parcelas. Sem essas três, uma
  // venda de R$ 383 em 12x entra como R$ 294 e a taxa de 23% some.
  | "net_amount"
  | "installments"
  | "installment_amount";

/** Coluna da planilha -> campo do pedido. Colunas ausentes = ignoradas. */
export type ColumnMapping = Partial<Record<FieldKey, string>>;

export const REQUIRED_FIELDS: FieldKey[] = ["external_order_id", "phone"];

export const FIELD_LABEL: Record<FieldKey, string> = {
  external_order_id: "ID do pedido / transação *",
  phone: "Telefone *",
  name: "Nome do comprador",
  email: "E-mail",
  product: "Produto",
  amount: "Valor",
  status: "Status",
  payment_method: "Forma de pagamento",
  date: "Data da compra",
  net_amount: "Valor líquido (o que sobrou)",
  installments: "Número de parcelas",
  installment_amount: "Valor da parcela",
};

/**
 * Detecção automática de coluna. Cada plataforma escreve o cabeçalho de um
 * jeito, então o casamento é por padrão e não por nome exato — e o usuário
 * corrige na tela antes de gravar. A ordem importa: o primeiro padrão que
 * casar leva a coluna, por isso `email` vem antes de `name` (senão
 * "E-mail do cliente" viraria nome) e `external_order_id` antes de tudo.
 */
const DETECTORS: [FieldKey, RegExp][] = [
  // As específicas vêm ANTES de `amount`, senão "Valor líquido" seria lida
  // como o valor da venda — e aí o faturamento entraria já descontado, sem
  // registrar taxa nenhuma.
  ["net_amount", /l[ií]quido|liquido|net.?(amount|value)|minha comiss[ãa]o/i],
  ["installment_amount", /valor.*parcela|parcela.*valor|installment.*(amount|value)/i],
  ["installments", /(n[uú]mero|qtd|quantidade|n[ºo°]).*parcela|parcelas?$|installments/i],
  [
    "external_order_id",
    /(id|c[oó]digo|codigo|n[uú]mero).*(pedido|venda|transa|fatura|compra|order|invoice)|^(order|transaction|invoice)[_ ]?id$|^id$|^c[oó]digo$|charge.?id/i,
  ],
  ["email", /e-?mail/i],
  ["phone", /telefone|celular|whatsapp|phone|fone|^ddd|contato/i],
  ["date", /data|date|criad|pago em|aprovad|created/i],
  ["amount", /valor|pre[cç]o|total|amount|price|receita|bruto/i],
  ["status", /status|situa[cç][aã]o|estado/i],
  ["payment_method", /pagamento|payment|m[eé]todo|forma/i],
  ["product", /produto|product|oferta|plano|item|curso/i],
  ["name", /nome|name|cliente|comprador|customer|buyer/i],
];

export function autoDetectMapping(columns: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  for (const [field, re] of DETECTORS) {
    const col = columns.find((c) => !taken.has(c) && re.test(c));
    if (col) {
      mapping[field] = col;
      taken.add(col);
    }
  }
  return mapping;
}

/**
 * Mesma regra do hubla-webhook: só dígitos, com DDI 55 garantido.
 * Sem isso o mesmo comprador vira dois leads — um do WhatsApp, um da planilha.
 */
export function normalizePhoneBR(raw: unknown): string {
  let str = raw == null ? "" : String(raw).trim();
  // Excel transforma telefone longo em notação científica (5.5119E+12).
  if (/^\d+\.?\d*[eE][+-]?\d+$/.test(str)) str = Number(str).toFixed(0);
  if (typeof raw === "number") str = raw.toFixed(0);

  let digits = str.replace(/\D/g, "");
  if (!digits) return "";
  // "+55 (11) 99999-8888" já vem com 55; "11999998888" não.
  if (!digits.startsWith("55")) digits = "55" + digits;
  return digits;
}

/** Telefone brasileiro plausível: 55 + DDD + 8 ou 9 dígitos. */
export function isPlausiblePhone(digits: string): boolean {
  return /^55\d{10,11}$/.test(digits);
}

/**
 * Valor em formato brasileiro ou americano.
 *
 * O caso que morde: "R$ 1.234,56". Um parseFloat direto devolve 1 — e o
 * faturamento do mês fica mil vezes menor sem nenhum erro na tela.
 *
 * Regra: o ÚLTIMO separador presente é o decimal quando há vírgula e ponto.
 * Só com ponto e exatamente 3 dígitos depois ("1.234"), é milhar — nenhum
 * exportador escreve centavos com três casas.
 */
export function parseAmountBR(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  let s = String(raw).trim();
  if (!s) return null;

  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  // Fora R$/US$/espaço fino do Excel, tudo que não for dígito ou separador sai.
  s = s.replace(/[^\d.,-]/g, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Os dois presentes: o último é o decimal, o outro é milhar.
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = s.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // Só vírgula: decimal brasileiro. "1.234" nunca chega aqui.
    normalized = s.replace(/,/g, ".");
  } else if (lastDot >= 0) {
    const afterDot = s.length - lastDot - 1;
    const dots = s.split(".").length - 1;
    normalized = dots > 1 || afterDot === 3 ? s.split(".").join("") : s;
  } else {
    normalized = s;
  }

  const value = parseFloat(normalized.replace(/-/g, ""));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Data em dd/MM/yyyy, ISO, ou número serial do Excel (o que `xlsx` devolve com
 * `raw: true`). Devolve ISO, ou null quando não dá para ter certeza —
 * inventar uma data faz a venda cair no mês errado.
 */
export function parseDateBR(raw: unknown): string | null {
  if (raw == null || raw === "") return null;

  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();

  // Serial do Excel: dias desde 1899-12-30. Abaixo de 1000 é número solto.
  if (typeof raw === "number") {
    if (raw < 1000 || raw > 100000) return null;
    return new Date(EXCEL_EPOCH_UTC + Math.round(raw * 86400000)).toISOString();
  }

  const s = String(raw).trim();
  if (!s) return null;

  // O separador entre data e hora varia: espaço, "T", ou " - " como a ApplyFy
  // exporta ("02/09/2026 - 22:38"). Sem aceitar o traço, a hora era descartada
  // e a venda ia para 00:00 UTC — que em Brasília é o DIA ANTERIOR, jogando a
  // venda para fora do mês no fechamento.
  const br = s.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s*(?:[T-]|\s)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (br) {
    const [, d, m, y, hh = "0", mm = "0", ss = "0"] = br;
    const date = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const date = new Date(s.length <= 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

/**
 * Status da plataforma -> status interno de `orders`. O vocabulário do
 * hubla-webhook é a referência; as outras plataformas entram por sinônimo.
 * Desconhecido vira 'pending' em vez de 'approved': contar como venda algo
 * que não foi paga é o erro caro.
 */
const STATUS_MAP: [RegExp, string][] = [
  [/aprovad|approved|paid|pago|complet|conclu|autoriz|active|ativa/i, "approved"],
  [/abandon/i, "abandoned"],
  [/estorn|reembols|refund|devolv/i, "refunded"],
  [/charge.?back|contesta/i, "chargeback"],
  [/cancel/i, "cancelled"],
  [/expir|vencid/i, "expired"],
  [/recusad|rejeit|fail|falh|decline|erro|negad/i, "failed"],
  [/pend|aguard|waiting|process|em an[aá]lise|gerad|unpaid|billet|boleto emitido/i, "pending"],
];

export function normalizeStatus(raw: unknown, fallback = "approved"): string {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return fallback;
  for (const [re, status] of STATUS_MAP) if (re.test(s)) return status;
  return "pending";
}

export interface ParsedOrder {
  externalOrderId: string;
  phone: string;
  name: string;
  email: string | null;
  productName: string | null;
  amount: number;
  /** Líquido informado pela planilha; nulo = a plataforma não separou taxa. */
  netAmount: number | null;
  status: string;
  paymentMethod: string | null;
  createdAt: string | null;
  /** número da linha na planilha, 1-based contando o cabeçalho */
  rowNumber: number;
}

export interface RowError {
  rowNumber: number;
  reason: string;
  /** identificador para o usuário achar a linha, quando existir */
  hint?: string;
}

export interface ParseResult {
  ok: boolean;
  /** presente quando ok === true */
  order?: ParsedOrder;
  /** presente quando ok === false */
  error?: RowError;
}


const text = (row: Record<string, unknown>, col?: string): string =>
  col ? String(row[col] ?? "").trim() : "";

/** Uma linha crua -> pedido, ou o motivo pelo qual ela não serve. */
export function parseRow(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  rowNumber: number,
  defaultStatus = "approved"
): ParseResult {
  const externalOrderId = text(row, mapping.external_order_id);
  if (!externalOrderId) {
    return { ok: false, error: { rowNumber, reason: "sem ID do pedido" } };
  }

  const phone = normalizePhoneBR(mapping.phone ? row[mapping.phone] : "");
  if (!phone) {
    return { ok: false, error: { rowNumber, reason: "sem telefone", hint: externalOrderId } };
  }
  if (!isPlausiblePhone(phone)) {
    return {
      ok: false,
      error: { rowNumber, reason: `telefone inválido (${phone})`, hint: externalOrderId },
    };
  }

  const liquido = mapping.net_amount ? parseAmountBR(row[mapping.net_amount]) : null;
  const valorParcela = mapping.installment_amount
    ? parseAmountBR(row[mapping.installment_amount])
    : null;
  const parcelas = mapping.installments
    ? Math.max(1, Math.round(Number(String(row[mapping.installments] ?? "").replace(/\D/g, "")) || 1))
    : null;

  const rawAmount = mapping.amount ? row[mapping.amount] : null;
  // Ordem de preferência do faturamento: a coluna de valor, depois o bruto
  // reconstruído das parcelas, depois o líquido. O bruto é o que o cliente
  // pagou; usar o líquido como faturamento esconde a taxa e faz a base de
  // comissão ser descontada duas vezes.
  const amount =
    parseAmountBR(rawAmount) ??
    (valorParcela != null && parcelas != null
      ? Math.round(valorParcela * parcelas * 100) / 100
      : null) ??
    liquido;
  if (mapping.amount && rawAmount !== "" && rawAmount != null && amount === null) {
    return {
      ok: false,
      error: { rowNumber, reason: `valor inválido ("${String(rawAmount)}")`, hint: externalOrderId },
    };
  }

  const rawDate = mapping.date ? row[mapping.date] : null;
  const createdAt = parseDateBR(rawDate);
  if (mapping.date && rawDate !== "" && rawDate != null && createdAt === null) {
    return {
      ok: false,
      error: { rowNumber, reason: `data inválida ("${String(rawDate)}")`, hint: externalOrderId },
    };
  }

  const name = text(row, mapping.name) || `Cliente ${phone.slice(-4)}`;
  const email = text(row, mapping.email) || null;
  const productName = text(row, mapping.product) || null;
  const paymentMethod = text(row, mapping.payment_method) || null;

  return {
    ok: true,
    order: {
      externalOrderId,
      phone,
      name,
      email,
      productName,
      amount: amount ?? 0,
      // Só vale como líquido se for MENOR que o bruto: planilha que traz o
      // mesmo número nas duas colunas não tem taxa a registrar.
      netAmount: liquido != null && amount != null && liquido < amount ? liquido : null,
      status: normalizeStatus(mapping.status ? row[mapping.status] : "", defaultStatus),
      paymentMethod,
      createdAt,
      rowNumber,
    },
  };
}

export interface ImportPlan {
  /** pedidos que ainda não existem em orders */
  create: ParsedOrder[];
  /** pedidos que já existem: atualizam status/valor/produto */
  update: ParsedOrder[];
  /** linhas descartadas, com motivo */
  errors: RowError[];
  /** IDs repetidos DENTRO do arquivo — vence a última ocorrência */
  duplicatesInFile: number;
}

/**
 * Decide o destino de cada linha. `existingIds` vem de uma consulta a
 * `orders.external_order_id` — é o que garante que reimportar o mesmo mês
 * atualize em vez de duplicar.
 */
export function planImport(
  results: ParseResult[],
  existingIds: Set<string>
): ImportPlan {
  const errors: RowError[] = [];
  const byId = new Map<string, ParsedOrder>();
  let duplicatesInFile = 0;

  for (const r of results) {
    if (!r.ok || !r.order) {
      if (r.error) errors.push(r.error);
      continue;
    }
    if (byId.has(r.order.externalOrderId)) duplicatesInFile++;
    // Última ocorrência vence: exportadores repetem a linha do pedido quando o
    // status muda, e a linha de baixo é a mais recente.
    byId.set(r.order.externalOrderId, r.order);
  }


  const create: ParsedOrder[] = [];
  const update: ParsedOrder[] = [];
  for (const order of byId.values()) {
    (existingIds.has(order.externalOrderId) ? update : create).push(order);
  }

  return { create, update, errors, duplicatesInFile };
}

/** Divide em lotes — `.in()` e insert em massa não aguentam a planilha inteira. */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
