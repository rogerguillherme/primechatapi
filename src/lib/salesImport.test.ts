// Check da leitura de planilha de vendas.
// Rodar: npm test
import { describe, expect, it } from "vitest";
import {
  autoDetectMapping,
  chunk,
  normalizePhoneBR,
  normalizeStatus,
  parseAmountBR,
  parseDateBR,
  parseRow,
  planImport,
  type ColumnMapping,
  type ParseResult,
} from "./salesImport";

describe("normalizePhoneBR", () => {
  it("garante o 55 sem duplicar quando já veio", () => {
    expect(normalizePhoneBR("11999998888")).toBe("5511999998888");
    expect(normalizePhoneBR("5511999998888")).toBe("5511999998888");
    expect(normalizePhoneBR("+55 (11) 99999-8888")).toBe("5511999998888");
  });

  it("aceita o telefone que o Excel converteu em notação científica", () => {
    // O bug: célula longa demais vira 5.5119999888e+12 e o replace(/\D/g)
    // devolveria "5511999988812" — um número que não existe.
    expect(normalizePhoneBR("5.5119999888e+12")).toBe("5511999988800");
    expect(normalizePhoneBR(5511999998888)).toBe("5511999998888");
  });

  it("devolve vazio para célula sem dígito", () => {
    expect(normalizePhoneBR("")).toBe("");
    expect(normalizePhoneBR("—")).toBe("");
    expect(normalizePhoneBR(null)).toBe("");
  });
});

describe("parseAmountBR", () => {
  it("lê o formato brasileiro com milhar e centavos", () => {
    // O erro caro: parseFloat("R$ 1.234,56") devolve 1.
    expect(parseAmountBR("R$ 1.234,56")).toBe(1234.56);
    expect(parseAmountBR("1.234,56")).toBe(1234.56);
    expect(parseAmountBR("R$ 12.345.678,90")).toBe(12345678.9);
  });

  it("lê o formato americano sem confundir com o brasileiro", () => {
    expect(parseAmountBR("1,234.56")).toBe(1234.56);
    expect(parseAmountBR("1234.56")).toBe(1234.56);
    expect(parseAmountBR("$1,234.00")).toBe(1234);
  });

  it("trata vírgula sozinha como decimal e ponto+3 dígitos como milhar", () => {
    expect(parseAmountBR("97,00")).toBe(97);
    expect(parseAmountBR("1234,5")).toBe(1234.5);
    expect(parseAmountBR("1.234")).toBe(1234);
    expect(parseAmountBR("1.23")).toBe(1.23);
  });

  it("passa número puro do Excel adiante", () => {
    expect(parseAmountBR(197)).toBe(197);
    expect(parseAmountBR(197.5)).toBe(197.5);
  });

  it("entende estorno em negativo e em parênteses", () => {
    expect(parseAmountBR("-R$ 97,00")).toBe(-97);
    expect(parseAmountBR("(97,00)")).toBe(-97);
  });

  it("devolve null em vez de zero quando não dá para ler", () => {
    // zero silencioso somaria receita errada; null vira linha com erro.
    expect(parseAmountBR("")).toBeNull();
    expect(parseAmountBR(null)).toBeNull();
    expect(parseAmountBR("grátis")).toBeNull();
  });
});

describe("parseDateBR", () => {
  it("lê dd/MM/yyyy com e sem hora", () => {
    expect(parseDateBR("15/08/2026")).toBe("2026-08-15T00:00:00.000Z");
    expect(parseDateBR("15/08/2026 14:30")).toBe("2026-08-15T14:30:00.000Z");
    // A ApplyFy exporta com traço entre data e hora. Sem aceitar isso, a hora
    // era descartada e a venda ia para 00:00 UTC — que em Brasília é o dia
    // anterior, jogando a venda para fora do mês no fechamento.
    expect(parseDateBR("02/09/2026 - 22:38")).toBe("2026-09-02T22:38:00.000Z");
  });

  it("não troca dia por mês em data ambígua", () => {
    // 03/08 é 3 de agosto, nunca 8 de março.
    expect(parseDateBR("03/08/2026")!.slice(0, 10)).toBe("2026-08-03");
  });

  it("lê ISO e serial do Excel", () => {
    expect(parseDateBR("2026-08-15")).toBe("2026-08-15T00:00:00.000Z");
    expect(parseDateBR(46249)!.slice(0, 10)).toBe("2026-08-15");
  });

  it("devolve null em vez de inventar data", () => {
    expect(parseDateBR("ontem")).toBeNull();
    expect(parseDateBR("")).toBeNull();
  });
});

describe("normalizeStatus", () => {
  it("traduz o vocabulário das plataformas", () => {
    expect(normalizeStatus("Aprovada")).toBe("approved");
    expect(normalizeStatus("paid")).toBe("approved");
    expect(normalizeStatus("Carrinho abandonado")).toBe("abandoned");
    expect(normalizeStatus("Reembolsado")).toBe("refunded");
    expect(normalizeStatus("Chargeback")).toBe("chargeback");
    expect(normalizeStatus("Cancelada")).toBe("cancelled");
    expect(normalizeStatus("Recusado")).toBe("failed");
    expect(normalizeStatus("Aguardando pagamento")).toBe("pending");
  });

  it("status desconhecido NÃO vira venda aprovada", () => {
    expect(normalizeStatus("xpto")).toBe("pending");
  });

  it("célula vazia usa o padrão escolhido na tela", () => {
    expect(normalizeStatus("")).toBe("approved");
    expect(normalizeStatus("", "pending")).toBe("pending");
  });
});

describe("autoDetectMapping", () => {
  it("não deixa a coluna de e-mail virar nome", () => {
    const m = autoDetectMapping(["Nome do cliente", "E-mail do cliente", "Telefone"]);
    expect(m.email).toBe("E-mail do cliente");
    expect(m.name).toBe("Nome do cliente");
  });

  it("não confunde coluna de ID com o campo que ela parece", () => {
    // "ID do comprador" contém "comprador" e vinha ANTES de "Nome do
    // comprador" no arquivo real da ApplyFy — o nome do cliente virava um
    // identificador opaco em todas as 3.556 linhas.
    const m = autoDetectMapping([
      "ID do pedido", "ID da transação", "ID do comprador",
      "Nome do comprador", "Email do comprador", "Status",
    ]);
    expect(m.name).toBe("Nome do comprador");
    expect(m.email).toBe("Email do comprador");
    expect(m.external_order_id).toBe("ID do pedido");
  });

  it("acha as colunas de uma exportação típica", () => {
    const m = autoDetectMapping([
      "ID da transação", "Comprador", "Email", "Celular",
      "Produto", "Valor líquido", "Status", "Data de criação",
    ]);
    expect(m).toMatchObject({
      external_order_id: "ID da transação",
      name: "Comprador",
      email: "Email",
      phone: "Celular",
      product: "Produto",
      // "Valor líquido" passa a ser lido como LÍQUIDO, não como o valor da
      // venda: numa planilha que traga as duas colunas, confundir os dois faz
      // o faturamento entrar já descontado e a taxa desaparecer.
      net_amount: "Valor líquido",
      status: "Status",
      date: "Data de criação",
    });
  });

  it("com só o líquido na planilha, ele ainda vira o valor da venda", () => {
    // Não havendo bruto nem parcelas, o líquido é o melhor número disponível —
    // e aí não se registra taxa, porque não há de onde tirá-la.
    const m = autoDetectMapping(["ID", "Celular", "Valor líquido", "Status"]);
    const r = parseRow(
      { ID: "x1", Celular: "11999998888", "Valor líquido": "97,00", Status: "Pago" },
      m,
      2,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.amount).toBe(97);
    expect(r.order.netAmount).toBeNull();
  });
});

const MAPPING: ColumnMapping = {
  external_order_id: "Pedido",
  name: "Cliente",
  phone: "Telefone",
  amount: "Valor",
  status: "Status",
  date: "Data",
};

describe("parseRow", () => {
  it("monta o pedido a partir da linha", () => {
    const r = parseRow(
      { Pedido: "INV-1", Cliente: "Maria", Telefone: "11999998888", Valor: "R$ 1.234,56", Status: "Pago", Data: "15/08/2026" },
      MAPPING,
      2
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order!.externalOrderId).toBe("INV-1");
    expect(r.order!.phone).toBe("5511999998888");
    expect(r.order!.amount).toBe(1234.56);
    expect(r.order!.status).toBe("approved");
  });

  it("rejeita linha sem ID e linha sem telefone, com motivo", () => {
    const semId = parseRow({ Pedido: "", Telefone: "11999998888" }, MAPPING, 3);
    expect(semId.ok).toBe(false);
    if (!semId.ok) expect(semId.error!.reason).toMatch(/ID/);

    const semTel = parseRow({ Pedido: "INV-2", Telefone: "" }, MAPPING, 4);
    expect(semTel.ok).toBe(false);
    if (!semTel.ok) expect(semTel.error!.hint).toBe("INV-2");
  });

  it("rejeita valor ilegível em vez de gravar zero", () => {
    const r = parseRow({ Pedido: "INV-3", Telefone: "11999998888", Valor: "combinado" }, MAPPING, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.reason).toMatch(/valor/);
  });

  it("coluna de valor não mapeada grava zero sem virar erro", () => {
    const r = parseRow({ Pedido: "INV-4", Telefone: "11999998888" }, { external_order_id: "Pedido", phone: "Telefone" }, 6);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order!.amount).toBe(0);
  });

  it("telefone curto demais não passa", () => {
    const r = parseRow({ Pedido: "INV-5", Telefone: "1234" }, MAPPING, 7);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.reason).toMatch(/inválido/);
  });
});

describe("bruto e líquido do CSV de checkout", () => {
  // O relatório da ApplyFy não tem coluna de bruto: ele traz o líquido e o
  // valor da parcela. Uma venda de R$ 383,64 em 12x aparece como "31,97" e
  // "294,51" — e sem reconstruir o bruto, a taxa de 23% desaparece.
  const colunas = [
    "ID da transação", "Telefone do comprador", "Status",
    "Valor líquido (minha comissão)", "Número de parcelas", "Valor da parcela",
    "Data da transação",
  ];

  it("não confunde o líquido com o valor da venda", () => {
    const m = autoDetectMapping(colunas);
    expect(m.net_amount).toBe("Valor líquido (minha comissão)");
    expect(m.installment_amount).toBe("Valor da parcela");
    expect(m.installments).toBe("Número de parcelas");
    // Sem coluna de bruto, `amount` fica sem par — o bruto vem das parcelas.
    expect(m.amount).toBeUndefined();
  });

  it("reconstrói o bruto das parcelas e guarda o líquido", () => {
    const r = parseRow(
      {
        "ID da transação": "tx1",
        "Telefone do comprador": "11999998888",
        "Status": "Concluído",
        "Valor líquido (minha comissão)": "294,51",
        "Número de parcelas": "12",
        "Valor da parcela": "31,97",
        "Data da transação": "02/09/2026 - 22:38",
      },
      autoDetectMapping(colunas),
      2,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.amount).toBe(383.64);
    expect(r.order.netAmount).toBe(294.51);
    expect(r.order.status).toBe("approved");
  });

  it("não inventa líquido quando ele é igual ao bruto", () => {
    const r = parseRow(
      {
        "ID da transação": "tx2",
        "Telefone do comprador": "11999998888",
        "Status": "Concluído",
        "Valor líquido (minha comissão)": "100,00",
        "Número de parcelas": "1",
        "Valor da parcela": "100,00",
        "Data da transação": "02/09/2026 - 10:00",
      },
      autoDetectMapping(colunas),
      3,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.amount).toBe(100);
    expect(r.order.netAmount).toBeNull();
  });
});

describe("planImport", () => {
  const order = (id: string, rowNumber: number): ParseResult => ({
    ok: true,
    order: {
      externalOrderId: id, phone: "5511999998888", name: "Maria", email: null,
      productName: null, amount: 97, netAmount: null, status: "approved",
      paymentMethod: null, createdAt: null, rowNumber,
    },
  });

  it("separa novos de atualizações pelo external_order_id", () => {
    const plan = planImport([order("A", 2), order("B", 3)], new Set(["B"]));
    expect(plan.create.map((o) => o.externalOrderId)).toEqual(["A"]);
    expect(plan.update.map((o) => o.externalOrderId)).toEqual(["B"]);
  });

  it("reimportar o mesmo mês não cria nada de novo", () => {
    // O erro que mais vai acontecer: subir a planilha duas vezes.
    const rows = [order("A", 2), order("B", 3), order("C", 4)];
    const plan = planImport(rows, new Set(["A", "B", "C"]));
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(3);
  });

  it("ID repetido dentro do arquivo colapsa numa linha só", () => {
    const first = order("A", 2);
    const second = order("A", 9);
    if (second.ok) second.order.status = "refunded";
    const plan = planImport([first, second], new Set());
    expect(plan.create).toHaveLength(1);
    expect(plan.duplicatesInFile).toBe(1);
    // última ocorrência vence: é a linha mais recente do exportador
    expect(plan.create[0].status).toBe("refunded");
  });

  it("linha inválida vira erro reportado, não aborta o lote", () => {
    const plan = planImport(
      [order("A", 2), { ok: false, error: { rowNumber: 3, reason: "sem telefone" } }, order("B", 4)],
      new Set()
    );
    expect(plan.create).toHaveLength(2);
    expect(plan.errors).toEqual([{ rowNumber: 3, reason: "sem telefone" }]);
  });
});

describe("chunk", () => {
  it("respeita o tamanho do lote", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
