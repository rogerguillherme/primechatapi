// Pure mapping helpers for the Metrito integration.
// Plain ESM (no TS) so both the Deno edge functions and the node self-check
// (test_metrito.mjs) can import the exact same code.

// Metrito transaction status enum (POST /v2/tracking/generic).
export const METRITO_STATUSES = [
  "pending",
  "approved",
  "authorized",
  "failed",
  "refunded",
  "chargeback",
  "under_analysis",
];

/**
 * Maps a Prime Chat / Hubla order status to Metrito's transaction status enum.
 * Unknown statuses fall back to "pending" — never an invalid value, because
 * Metrito rejects the whole transaction on an out-of-enum status.
 */
export function mapHublaStatusToMetrito(status) {
  const s = String(status || "").toLowerCase().trim();
  switch (s) {
    case "approved":
    case "paid":
    case "succeeded":
      return "approved";
    case "authorized":
      return "authorized";
    case "refunded":
      return "refunded";
    case "chargeback":
      return "chargeback";
    // Hubla has no "cancelled" equivalent in Metrito. A cancelled invoice was
    // never collected, so it is reported as a failed transaction (not a refund,
    // which would subtract revenue Metrito never counted).
    case "cancelled":
    case "canceled":
    case "failed":
    case "expired":
      return "failed";
    case "under_analysis":
    case "analysis":
    case "in_analysis":
      return "under_analysis";
    // Abandoned checkout / unpaid invoice: the transaction exists but was
    // never completed.
    case "abandoned":
    case "pending":
    case "unpaid":
    case "draft":
    case "overdue":
      return "pending";
    default:
      return "pending";
  }
}

/**
 * Converts a BRL amount (reais, possibly fractional) to integer cents.
 * Metrito requires integer cents; 29.99 * 100 is 2998.9999... in float, so
 * rounding is mandatory here.
 */
export function toCents(amount) {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount ?? ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Decide entre a credencial cadastrada pela conta e a global.
 *
 * Tudo ou nada: se a conta cadastrou qualquer campo, os campos vazios DELA
 * ficam nulos em vez de herdar o global. Herdar por campo misturaria a chave de
 * uma conta com o projeto de outra, e o dado iria para o painel errado sem
 * ninguém perceber.
 */
export function pickMetritoCreds(own, env) {
  const clean = (v) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || null;
  };
  const mine = {
    apiKey: clean(own?.apiKey),
    genericKey: clean(own?.genericKey),
    projectId: clean(own?.projectId),
  };
  const hasOwn = !!(mine.apiKey || mine.genericKey || mine.projectId);
  if (hasOwn) return mine;
  return {
    apiKey: clean(env?.apiKey),
    genericKey: clean(env?.genericKey),
    projectId: clean(env?.projectId),
  };
}
