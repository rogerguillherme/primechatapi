import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  parseISO,
  isValid,
  format,
} from "date-fns";

export type ModoPeriodo = "mensal" | "diario" | "periodo";

/**
 * Período das telas do Metrik, guardado na URL.
 *
 * Na URL e não em estado de componente por dois motivos: trocar de aba mantém
 * o recorte — ver o ranking de setembro e cair no dashboard de hoje seria uma
 * armadilha —, e o link fica compartilhável, que é como se manda um resultado
 * para alguém sem mandar junto um "filtre por tal data".
 */
export function useMetrikPeriodo() {
  const [params, setParams] = useSearchParams();

  const modo = (params.get("modo") as ModoPeriodo) || "mensal";

  const { inicio, fim } = useMemo(() => {
    const hoje = new Date();
    const de = params.get("de");
    const ate = params.get("ate");

    if (modo === "diario") {
      const d = de && isValid(parseISO(de)) ? parseISO(de) : hoje;
      return { inicio: startOfDay(d), fim: endOfDay(d) };
    }

    if (modo === "periodo") {
      const d1 = de && isValid(parseISO(de)) ? parseISO(de) : startOfMonth(hoje);
      const d2 = ate && isValid(parseISO(ate)) ? parseISO(ate) : hoje;
      // Datas invertidas não devolvem lista vazia sem explicação: a ordem é
      // corrigida em silêncio, que é o que a pessoa quis dizer de qualquer jeito.
      return d1 <= d2
        ? { inicio: startOfDay(d1), fim: endOfDay(d2) }
        : { inicio: startOfDay(d2), fim: endOfDay(d1) };
    }

    const base = de && isValid(parseISO(de)) ? parseISO(de) : hoje;
    return { inicio: startOfMonth(base), fim: endOfMonth(base) };
  }, [modo, params]);

  const definir = (novo: { modo?: ModoPeriodo; de?: Date; ate?: Date }) => {
    const p = new URLSearchParams(params);
    if (novo.modo) p.set("modo", novo.modo);
    if (novo.de) p.set("de", format(novo.de, "yyyy-MM-dd"));
    if (novo.ate) p.set("ate", format(novo.ate, "yyyy-MM-dd"));
    setParams(p, { replace: true });
  };

  return { modo, inicio, fim, definir };
}
