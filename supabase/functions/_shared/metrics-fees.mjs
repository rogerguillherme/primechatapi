// Taxa da plataforma por venda, e a base de comissão que resulta dela.
//
// A taxa não é um percentual só: "3% + R$ 2,49" é a forma normal de cobrança
// de checkout, e ignorar a parte fixa erra pouco em venda grande e MUITO em
// venda pequena — num pedido de R$ 20, R$ 2,49 é 12%, não 3%.

/**
 * Escolhe a taxa que vale para uma venda.
 *
 * Do mais específico para o mais geral: plataforma+meio, depois plataforma
 * (qualquer meio), depois uma regra sem plataforma que sirva de padrão. Não
 * achando nada, taxa zero — inventar um percentual seria pior que assumir que
 * ainda não foi configurado.
 */
export function taxaAplicavel(regras, platform, method) {
  const lista = regras || [];
  const p = (platform || "").toLowerCase();
  const m = (method || "").toLowerCase();
  const igual = (a, b) => String(a || "").toLowerCase() === b;

  return (
    lista.find((r) => igual(r.platform, p) && igual(r.payment_method, m) && m) ||
    lista.find((r) => igual(r.platform, p) && !r.payment_method) ||
    lista.find((r) => !r.platform && igual(r.payment_method, m) && m) ||
    lista.find((r) => !r.platform && !r.payment_method) ||
    null
  );
}

/** Quanto a plataforma retém de uma venda. Nunca mais que o próprio valor. */
export function taxaDaVenda(valor, regras, platform, method) {
  const v = Number(valor) || 0;
  if (v <= 0) return 0;
  const r = taxaAplicavel(regras, platform, method);
  if (!r) return 0;
  const bruta = v * ((Number(r.percent) || 0) / 100) + (Number(r.fixed) || 0);
  // Taxa maior que a venda existe em pedido muito pequeno com taxa fixa alta.
  // Deixar passar produziria base negativa e comissão negativa.
  return Math.round(Math.min(v, Math.max(0, bruta)) * 100) / 100;
}

/**
 * Base de comissão, com o que descontar decidido pela empresa.
 *
 * Anúncio vem desligado por padrão de propósito: o vendedor não escolhe quanto
 * se gasta em tráfego, e descontar isso da comissão dele transfere um risco
 * que não é dele.
 */
export function baseConfigurada({ faturamento, reembolsos = 0, taxas = 0, ads = 0 }, flags = {}) {
  const { descontarTaxas = true, descontarReembolsos = true, descontarAds = false } = flags;
  let base = Number(faturamento) || 0;
  if (descontarReembolsos) base -= Number(reembolsos) || 0;
  if (descontarTaxas) base -= Number(taxas) || 0;
  if (descontarAds) base -= Number(ads) || 0;
  return base > 0 ? Math.round(base * 100) / 100 : 0;
}
