import { useCallback, useEffect, useRef } from "react";

/**
 * Som curto de notificação, sintetizado na hora.
 *
 * Sem arquivo de áudio de propósito: um .mp3 seria mais um asset para baixar,
 * e o navegador bloqueia áudio até a pessoa interagir com a página de qualquer
 * jeito. Duas notas geradas no WebAudio resolvem em bytes zero.
 *
 * O navegador só libera som depois de um clique/tecla — até lá o contexto fica
 * suspenso. Retomamos no primeiro gesto, sem pedir nada ao usuário.
 */
export function useNotificationSound(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const destravar = () => {
      try {
        if (!ctxRef.current) {
          const Ctx = window.AudioContext || (window as any).webkitAudioContext;
          if (Ctx) ctxRef.current = new Ctx();
        }
        void ctxRef.current?.resume();
      } catch {
        /* navegador sem WebAudio: segue sem som */
      }
    };

    window.addEventListener("pointerdown", destravar, { once: true });
    window.addEventListener("keydown", destravar, { once: true });
    return () => {
      window.removeEventListener("pointerdown", destravar);
      window.removeEventListener("keydown", destravar);
    };
  }, [enabled]);

  return useCallback(() => {
    if (!enabled) return;
    const ctx = ctxRef.current;
    // Contexto ainda suspenso significa que ninguém tocou na página: o
    // navegador bloquearia o som de qualquer forma.
    if (!ctx || ctx.state !== "running") return;

    try {
      const agora = ctx.currentTime;
      // Duas notas ascendentes, curtas — reconhecível sem ser estridente.
      for (const [freq, atraso] of [[880, 0], [1174.7, 0.09]] as const) {
        const osc = ctx.createOscillator();
        const vol = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        // Rampa em vez de corte seco: corte gera estalo.
        vol.gain.setValueAtTime(0.0001, agora + atraso);
        vol.gain.exponentialRampToValueAtTime(0.14, agora + atraso + 0.012);
        vol.gain.exponentialRampToValueAtTime(0.0001, agora + atraso + 0.16);
        osc.connect(vol).connect(ctx.destination);
        osc.start(agora + atraso);
        osc.stop(agora + atraso + 0.18);
      }
    } catch {
      /* som é conforto, não função: nunca pode derrubar a tela */
    }
  }, [enabled]);
}
