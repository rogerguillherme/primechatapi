import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Exibe o nome da conta seguido dos últimos 4 dígitos do telefone. */
export function formatAccountName(account: {
  name?: string | null;
  display_phone_number?: string | null;
  phone_number_id?: string | null;
}): string {
  const digits = (account.display_phone_number || account.phone_number_id || "").replace(/\D/g, "");
  const suffix = digits.slice(-4);
  return suffix ? `${account.name || "Conta"} · ${suffix}` : (account.name || "Conta");
}

