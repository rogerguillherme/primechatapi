/**
 * Mapa DDD → estado.
 *
 * A geolocalização do painel sai do telefone do comprador, que é o único dado
 * de localização que a operação realmente coleta. Cobrar CEP só para pintar um
 * mapa seria pedir atrito no checkout em troca de enfeite.
 */
const MAPA: Record<string, { uf: string; estado: string }> = {
  "11": { uf: "SP", estado: "São Paulo" },
  "12": { uf: "SP", estado: "São Paulo" },
  "13": { uf: "SP", estado: "São Paulo" },
  "14": { uf: "SP", estado: "São Paulo" },
  "15": { uf: "SP", estado: "São Paulo" },
  "16": { uf: "SP", estado: "São Paulo" },
  "17": { uf: "SP", estado: "São Paulo" },
  "18": { uf: "SP", estado: "São Paulo" },
  "19": { uf: "SP", estado: "São Paulo" },
  "21": { uf: "RJ", estado: "Rio de Janeiro" },
  "22": { uf: "RJ", estado: "Rio de Janeiro" },
  "24": { uf: "RJ", estado: "Rio de Janeiro" },
  "27": { uf: "ES", estado: "Espírito Santo" },
  "28": { uf: "ES", estado: "Espírito Santo" },
  "31": { uf: "MG", estado: "Minas Gerais" },
  "32": { uf: "MG", estado: "Minas Gerais" },
  "33": { uf: "MG", estado: "Minas Gerais" },
  "34": { uf: "MG", estado: "Minas Gerais" },
  "35": { uf: "MG", estado: "Minas Gerais" },
  "37": { uf: "MG", estado: "Minas Gerais" },
  "38": { uf: "MG", estado: "Minas Gerais" },
  "41": { uf: "PR", estado: "Paraná" },
  "42": { uf: "PR", estado: "Paraná" },
  "43": { uf: "PR", estado: "Paraná" },
  "44": { uf: "PR", estado: "Paraná" },
  "45": { uf: "PR", estado: "Paraná" },
  "46": { uf: "PR", estado: "Paraná" },
  "47": { uf: "SC", estado: "Santa Catarina" },
  "48": { uf: "SC", estado: "Santa Catarina" },
  "49": { uf: "SC", estado: "Santa Catarina" },
  "51": { uf: "RS", estado: "Rio Grande do Sul" },
  "53": { uf: "RS", estado: "Rio Grande do Sul" },
  "54": { uf: "RS", estado: "Rio Grande do Sul" },
  "55": { uf: "RS", estado: "Rio Grande do Sul" },
  "61": { uf: "DF", estado: "Distrito Federal" },
  "62": { uf: "GO", estado: "Goiás" },
  "64": { uf: "GO", estado: "Goiás" },
  "63": { uf: "TO", estado: "Tocantins" },
  "65": { uf: "MT", estado: "Mato Grosso" },
  "66": { uf: "MT", estado: "Mato Grosso" },
  "67": { uf: "MS", estado: "Mato Grosso do Sul" },
  "68": { uf: "AC", estado: "Acre" },
  "69": { uf: "RO", estado: "Rondônia" },
  "71": { uf: "BA", estado: "Bahia" },
  "73": { uf: "BA", estado: "Bahia" },
  "74": { uf: "BA", estado: "Bahia" },
  "75": { uf: "BA", estado: "Bahia" },
  "77": { uf: "BA", estado: "Bahia" },
  "79": { uf: "SE", estado: "Sergipe" },
  "81": { uf: "PE", estado: "Pernambuco" },
  "87": { uf: "PE", estado: "Pernambuco" },
  "82": { uf: "AL", estado: "Alagoas" },
  "83": { uf: "PB", estado: "Paraíba" },
  "84": { uf: "RN", estado: "Rio Grande do Norte" },
  "85": { uf: "CE", estado: "Ceará" },
  "88": { uf: "CE", estado: "Ceará" },
  "86": { uf: "PI", estado: "Piauí" },
  "89": { uf: "PI", estado: "Piauí" },
  "91": { uf: "PA", estado: "Pará" },
  "93": { uf: "PA", estado: "Pará" },
  "94": { uf: "PA", estado: "Pará" },
  "92": { uf: "AM", estado: "Amazonas" },
  "97": { uf: "AM", estado: "Amazonas" },
  "95": { uf: "RR", estado: "Roraima" },
  "96": { uf: "AP", estado: "Amapá" },
  "98": { uf: "MA", estado: "Maranhão" },
  "99": { uf: "MA", estado: "Maranhão" },
};

/**
 * Extrai o estado de um telefone em qualquer formato usado no CRM
 * (+55 11 9..., 5511 9..., 011 9...). Devolve null quando não dá para afirmar:
 * chutar um estado sujaria o ranking com dado inventado.
 */
export function estadoPorTelefone(
  telefone: string | null | undefined,
): { uf: string; estado: string } | null {
  if (!telefone) return null;
  let d = telefone.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length < 10) return null;
  return MAPA[d.slice(0, 2)] ?? null;
}
