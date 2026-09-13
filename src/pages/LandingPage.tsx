import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";

// TODO: trocar pelo número real do WhatsApp do time
const WHATSAPP_URL = "https://wa.me/5500000000000";

const FONT_DISPLAY = "'Fraunces', Georgia, 'Times New Roman', serif";
const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace";
const FONT_BODY = "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif";

const EYEBROW = "inline-flex items-center gap-[0.55em] text-[0.78rem] font-semibold uppercase tracking-[0.11em] text-[#086b53] dark:text-[#56d9af]";
const EYEBROW_ON_DARK = "inline-flex items-center gap-[0.55em] text-[0.78rem] font-semibold uppercase tracking-[0.11em] text-[#7fe3bf]";

const BTN = "inline-flex items-center justify-center gap-2 rounded-[11px] px-[1.35em] py-[0.78em] text-[0.98rem] font-semibold leading-none transition-transform duration-150 hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#086b53] dark:focus-visible:outline-[#56d9af]";
const BTN_PRIMARY = "bg-[#0e8f6f] text-[#f3fbf7] shadow-[0_10px_24px_-12px_rgba(14,143,111,0.7)] hover:bg-[#086b53] dark:bg-[#2bbf94] dark:text-[#06120e] dark:shadow-[0_10px_24px_-12px_rgba(43,191,148,0.7)] dark:hover:bg-[#56d9af]";
const BTN_GHOST = "border border-[#d9ddd6] bg-transparent text-[#12191a] hover:border-[#54635e] dark:border-[#24322d] dark:text-[#eef3ef] dark:hover:border-[#9fb0aa]";
const BTN_SM = "px-[1.05em] py-[0.6em] text-[0.88rem]";

const TAG = "whitespace-nowrap rounded-[5px] bg-[#eceee9] px-[0.46em] py-[0.1em] text-[0.85em] text-[#3c453f] dark:bg-[#16211d] dark:text-[#c9d6cf]";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Revela um elemento (fade + translateY + leve tilt 3D) quando ele entra na viewport. Dispara uma vez só. */
function useInView<T extends HTMLElement>(threshold = 0.18) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, visible };
}

/** Estilo de entrada por scroll: opacidade + translateY + rotateX, com perspective embutido no próprio transform
 * (evita precisar de wrapper extra só pra dar `perspective` no elemento pai). `index` escalona o delay (stagger). */
function revealStyle(visible: boolean, index = 0): React.CSSProperties {
  return {
    opacity: visible ? 1 : 0,
    transform: visible
      ? "perspective(1000px) translateY(0) rotateX(0deg)"
      : "perspective(1000px) translateY(24px) rotateX(-6deg)",
    transition: "opacity 0.6s ease, transform 0.6s ease",
    transitionDelay: visible ? `${Math.min(index, 6) * 70}ms` : "0ms",
  };
}

/** Tilt 3D sutil que segue o cursor no hover (±5deg). Atualiza via rAF (sem setState a cada pixel) e
 * fica desativado com prefers-reduced-motion. */
function useTilt<T extends HTMLElement>(max = 5) {
  const ref = useRef<T | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const frame = useRef<number | null>(null);

  const reset = useCallback(() => {
    setStyle({ transform: "perspective(900px) rotateX(0deg) rotateY(0deg)", transition: "transform 0.4s ease" });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    const handleMove = (e: MouseEvent) => {
      if (frame.current != null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const rect = el.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        setStyle({
          transform: `perspective(900px) rotateX(${(-py * max * 2).toFixed(2)}deg) rotateY(${(px * max * 2).toFixed(2)}deg)`,
          transition: "transform 0.1s ease-out",
        });
      });
    };
    const handleLeave = () => {
      if (frame.current != null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      reset();
    };

    el.addEventListener("mousemove", handleMove);
    el.addEventListener("mouseleave", handleLeave);
    return () => {
      el.removeEventListener("mousemove", handleMove);
      el.removeEventListener("mouseleave", handleLeave);
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [max, reset]);

  return { ref, style };
}

/** Junta duas refs no mesmo nó DOM (precisamos da ref do useInView e da do useTilt no mesmo elemento). */
function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

function Dot({ tone = "accent" }: { tone?: "accent" | "money" }) {
  const color = tone === "money" ? "bg-[#b8711c] dark:bg-[#e8a752]" : "bg-[#0e8f6f] dark:bg-[#2bbf94]";
  const ring = tone === "money" ? "border-[#b8711c] dark:border-[#e8a752]" : "border-[#0e8f6f] dark:border-[#2bbf94]";
  return (
    <span className="relative inline-flex h-[9px] w-[9px] flex-none">
      <span className={`absolute inset-0 rounded-full ${color}`} />
      <span className={`absolute -inset-[5px] rounded-full border opacity-60 motion-safe:animate-ping ${ring}`} />
    </span>
  );
}

/** Pictograma de pessoa em traço fino (line-art), sem rosto/pele — silhueta abstrata pra reforçar
 * "gente de verdade por trás" sem parecer foto real ou stock image. `variant` troca só o acessório
 * (balão de fala, seta de fluxo, escudo) mantendo o mesmo corpo/traço nas três versões. */
function PersonIcon({
  variant = "plain",
  className = "h-8 w-8",
}: {
  variant?: "plain" | "speech" | "flow" | "shield";
  className?: string;
}) {
  return (
    <svg viewBox="0 0 26 28" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="7" r="3.6" />
      <path d="M2.2 24c0-5.4 3-8.7 6.8-8.7s6.8 3.3 6.8 8.7" />
      {variant === "speech" && (
        <path d="M16 1.4h7.4a1 1 0 0 1 1 1v4.6a1 1 0 0 1-1 1h-4.4l-2.3 2.3v-2.3h-.7a1 1 0 0 1-1-1V2.4a1 1 0 0 1 1-1Z" />
      )}
      {variant === "flow" && <path d="M24 2.5c-2.6 0-5.2.9-7 2.6M24 2.5v3.4M24 2.5h-3.4" />}
      {variant === "shield" && (
        <path d="M20 1.6l4.4 1.5v3.3c0 3-1.9 5-4.4 5.8-2.5-.8-4.4-2.8-4.4-5.8V3.1L20 1.6Z" />
      )}
    </svg>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className={TAG} style={{ fontFamily: FONT_MONO }}>
      {children}
    </span>
  );
}

const PLATAFORMAS = ["Hotmart", "Kiwify", "Monetizze", "Perfect Pay", "Eduzz", "Cakto", "Kirvano", "Ticto", "Assiny", "HyperCash", "Hubla", "ApplyFy"];

function FlowCard({
  dorTag,
  dorTitle,
  dorText,
  solTag,
  solContent,
  index = 0,
}: {
  dorTag: string;
  dorTitle: string;
  dorText: string;
  solTag: string;
  solContent: React.ReactNode;
  index?: number;
}) {
  const { ref: inViewRef, visible } = useInView<HTMLElement>();
  const { ref: tiltRef, style: tiltStyle } = useTilt<HTMLElement>();
  return (
    <article
      ref={mergeRefs(inViewRef, tiltRef)}
      style={{ ...revealStyle(visible, index), ...tiltStyle }}
      className="grid grid-cols-1 items-center gap-4 rounded-[14px] border border-[#d9ddd6] bg-white p-5 dark:border-[#24322d] dark:bg-[#101917] sm:p-7 md:grid-cols-[1fr_auto_1.2fr] md:gap-6"
    >
      <div className="border-l-[3px] border-[#a24632] pl-4 dark:border-[#e08b6f]">
        <span
          className="mb-[0.6em] block text-[0.72rem] uppercase tracking-[0.08em] text-[#a24632] dark:text-[#e08b6f]"
          style={{ fontFamily: FONT_MONO }}
        >
          {dorTag}
        </span>
        <h3
          className="mb-[0.5em] text-balance text-[1.18rem] leading-tight text-[#12191a] dark:text-[#eef3ef]"
          style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}
        >
          {dorTitle}
        </h3>
        <p className="text-[0.98rem] text-[#54635e] dark:text-[#9fb0aa]">{dorText}</p>
      </div>

      <span className="order-3 rotate-90 justify-self-start text-[1.4rem] text-[#54635e] dark:text-[#9fb0aa] md:order-2 md:rotate-0 md:justify-self-center" style={{ fontFamily: FONT_MONO }}>
        →
      </span>

      <div className="order-2 border-l-[3px] border-[#0e8f6f] pl-4 dark:border-[#2bbf94] md:order-3">
        <span
          className="mb-[0.6em] block text-[0.72rem] uppercase tracking-[0.08em] text-[#086b53] dark:text-[#56d9af]"
          style={{ fontFamily: FONT_MONO }}
        >
          {solTag}
        </span>
        <p className="text-[0.98rem] text-[#12191a] dark:text-[#eef3ef]">{solContent}</p>
      </div>
    </article>
  );
}

function FeatureCard({
  title,
  text,
  index = 0,
  icon,
}: {
  title: string;
  text: string;
  index?: number;
  icon?: "plain" | "speech" | "flow" | "shield";
}) {
  const { ref: inViewRef, visible } = useInView<HTMLElement>();
  const { ref: tiltRef, style: tiltStyle } = useTilt<HTMLElement>();
  return (
    <article
      ref={mergeRefs(inViewRef, tiltRef)}
      style={{ ...revealStyle(visible, index), ...tiltStyle }}
      className="flex flex-col gap-[0.7em] rounded-[14px] border border-[#d9ddd6] bg-white p-5 dark:border-[#24322d] dark:bg-[#101917] sm:p-7"
    >
      {icon && <PersonIcon variant={icon} className="h-8 w-8 text-[#0e8f6f] dark:text-[#2bbf94]" />}
      <h3 className="text-[1.1rem] text-[#12191a] dark:text-[#eef3ef]" style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}>
        {title}
      </h3>
      <p className="text-[0.97rem] leading-relaxed text-[#54635e] dark:text-[#9fb0aa]">{text}</p>
    </article>
  );
}

function Chip({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="flex items-center gap-[0.6em] rounded-[11px] border border-white/20 px-[1.1em] py-[0.75em] text-[0.9rem]">
      <Dot />
      <div>
        <b className="text-[0.86rem] font-semibold" style={{ fontFamily: FONT_MONO }}>
          {name}
        </b>
        <br />
        <span className="text-[0.84rem] text-[#a9bdb6]">{desc}</span>
      </div>
    </div>
  );
}

function TrustBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-[0.5em] rounded-full border border-[#0e8f6f]/30 bg-[#e3f3ec] text-[#086b53] dark:border-[#2bbf94]/30 dark:bg-[#123a2e] dark:text-[#7fe3bf] ${
        compact ? "px-[0.9em] py-[0.42em] text-[0.78rem]" : "px-[1.1em] py-[0.55em] text-[0.86rem]"
      } font-medium`}
    >
      <ShieldCheck className={compact ? "h-[0.95em] w-[0.95em]" : "h-[1.1em] w-[1.1em]"} strokeWidth={2.25} aria-hidden />
      Roda na API oficial do WhatsApp Business
    </span>
  );
}

function Objection({ q, a, index = 0 }: { q: string; a: string; index?: number }) {
  const { ref, visible } = useInView<HTMLDetailsElement>();
  return (
    <details
      ref={ref}
      style={revealStyle(visible, index)}
      className="group rounded-[14px] border border-[#d9ddd6] bg-white px-[22px] py-1 transition-colors open:border-[#0e8f6f] dark:border-[#24322d] dark:bg-[#101917] dark:open:border-[#2bbf94]"
    >
      <summary
        className="relative cursor-pointer list-none py-[18px] pr-[34px] text-[1.05rem] font-semibold text-[#12191a] marker:content-none dark:text-[#eef3ef] [&::-webkit-details-marker]:hidden"
        style={{ fontFamily: FONT_DISPLAY }}
      >
        {q}
        <span
          className="absolute right-0 top-1/2 -translate-y-1/2 text-[1.3rem] text-[#086b53] dark:text-[#56d9af] group-open:hidden"
          style={{ fontFamily: FONT_MONO }}
        >
          +
        </span>
        <span
          className="absolute right-0 top-1/2 hidden -translate-y-1/2 text-[1.3rem] text-[#086b53] dark:text-[#56d9af] group-open:block"
          style={{ fontFamily: FONT_MONO }}
        >
          –
        </span>
      </summary>
      <p className="max-w-[70ch] pb-5 text-[0.98rem] leading-relaxed text-[#54635e] dark:text-[#9fb0aa]">{a}</p>
    </details>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();

  const heroMockupTilt = useTilt<HTMLDivElement>();
  const praQuemESection = useInView<HTMLElement>();
  const comoFuncionaSection = useInView<HTMLElement>();
  const provaSection = useInView<HTMLElement>();
  const recursosSection = useInView<HTMLElement>();
  const objecoesSection = useInView<HTMLElement>();

  return (
    <div
      className="min-h-screen bg-[#f4f6f3] px-[clamp(18px,5vw,56px)] text-[1.0625rem] leading-[1.6] text-[#12191a] antialiased dark:bg-[#0b1210] dark:text-[#eef3ef]"
      style={{ fontFamily: FONT_BODY }}
    >
      <div className="mx-auto max-w-[1140px]">
        {/* nav */}
        <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-[#e6e9e3] bg-[#f4f6f3]/90 py-4 backdrop-blur-md dark:border-[#1a2622] dark:bg-[#0b1210]/90">
          <div className="flex items-center gap-[0.55em] text-[1rem] font-semibold" style={{ fontFamily: FONT_MONO }}>
            <Dot />
            Prime Chat
          </div>
          <ul className="hidden gap-7 text-[0.94rem] text-[#54635e] dark:text-[#9fb0aa] md:flex">
            <li>
              <a href="#como-funciona" className="hover:text-[#12191a] dark:hover:text-[#eef3ef]">
                Como funciona
              </a>
            </li>
            <li>
              <a href="#prova" className="hover:text-[#12191a] dark:hover:text-[#eef3ef]">
                Prova
              </a>
            </li>
            <li>
              <a href="#recursos" className="hover:text-[#12191a] dark:hover:text-[#eef3ef]">
                Recursos
              </a>
            </li>
            <li>
              <a href="#objecoes" className="hover:text-[#12191a] dark:hover:text-[#eef3ef]">
                Objeções
              </a>
            </li>
          </ul>
          <button className={`${BTN} ${BTN_PRIMARY} ${BTN_SM}`} onClick={() => navigate("/teste-gratis")}>
            Teste grátis
          </button>
        </header>

        <main>
          {/* hero */}
          <section className="relative pt-[clamp(40px,7vw,84px)]">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-5 z-0 hidden h-[520px] w-[60%] max-w-[640px] [background-image:radial-gradient(rgba(14,143,111,0.14)_1.5px,transparent_1.5px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_70%_20%,#000_0%,transparent_68%)] dark:[background-image:radial-gradient(rgba(43,191,148,0.16)_1.5px,transparent_1.5px)] md:block"
            />
            <div className="relative z-10 grid grid-cols-1 items-center gap-8 md:grid-cols-[1.15fr_1fr] md:gap-16">
              <div>
                <p className={EYEBROW}>
                  <Dot />
                  CRM de WhatsApp · automação de vendas
                </p>
                <h1
                  className="my-[0.5em] mb-[0.42em] text-balance text-[clamp(2.15rem,4.6vw,3.7rem)] leading-[1.06] tracking-[-0.01em] text-[#12191a] dark:text-[#eef3ef]"
                  style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}
                >
                  O CRM de WhatsApp que a gente não vendia pra ninguém — porque estava ocupado vendendo com ele.
                </h1>
                <p className="max-w-[56ch] text-[1.14rem] leading-[1.65] text-[#54635e] dark:text-[#9fb0aa]">
                  Prime Chat é o sistema que já roda operação comercial de verdade: inbox de WhatsApp, fluxo de automação
                  sem código e vendas entrando sozinhas de mais de 12 checkouts. Agora outras operações que vendem por
                  WhatsApp também podem rodar nele.
                </p>
                <div className="mt-[1.9em] flex flex-wrap items-center gap-3.5">
                  <button className={`${BTN} ${BTN_PRIMARY}`} onClick={() => navigate("/teste-gratis")}>
                    Teste grátis
                  </button>
                  <a className={`${BTN} ${BTN_GHOST}`} href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                    Falar com o time
                  </a>
                </div>
                <div className="mt-[1.1em]">
                  <TrustBadge />
                </div>
                <p className="mt-[0.9em] text-[0.78rem] text-[#54635e] opacity-75 dark:text-[#9fb0aa]" style={{ fontFamily: FONT_MONO }}>
                  /teste-gratis já leva pro cadastro real · "Falar com o time" abre WhatsApp com número placeholder — troque pelo
                  real na publicação.
                </p>
              </div>

              <div
                ref={heroMockupTilt.ref}
                style={heroMockupTilt.style}
                aria-hidden
                className="overflow-hidden rounded-[20px] border border-[#d9ddd6] bg-white shadow-[0_20px_45px_-25px_rgba(18,25,26,0.35)] dark:border-[#24322d] dark:bg-[#101917] dark:shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)]"
              >
                <div className="flex items-center gap-3 border-b border-[#e6e9e3] p-[18px] dark:border-[#1a2622]">
                  <div className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-gradient-to-br from-[#0e8f6f] to-[#086b53] text-[#f3fbf7] dark:from-[#2bbf94] dark:to-[#56d9af] dark:text-[#06120e]">
                    <PersonIcon className="h-[19px] w-[19px]" />
                  </div>
                  <div>
                    <strong className="block text-[0.95rem] text-[#12191a] dark:text-[#eef3ef]">Ana P. · lead</strong>
                    <span className="text-[0.8rem] text-[#54635e] dark:text-[#9fb0aa]">via WhatsApp Business</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 bg-[#f4f6f3] p-[18px] dark:bg-[#0b1210]">
                  <div className="max-w-[82%] self-start rounded-2xl rounded-bl-[4px] border border-[#d9ddd6] bg-white px-[0.9em] py-[0.65em] text-[0.92rem] leading-[1.5] text-[#12191a] dark:border-[#24322d] dark:bg-[#101917] dark:text-[#eef3ef]">
                    Oi! Vi o story, quero entender como funciona 🙋‍♀️
                  </div>
                  <div className="max-w-[82%] self-end rounded-2xl rounded-br-[4px] bg-[#e3f3ec] px-[0.9em] py-[0.65em] text-[0.92rem] leading-[1.5] text-[#12191a] dark:bg-[#123a2e] dark:text-[#eef3ef]">
                    Consegui aqui! Te mando os detalhes e um link em instantes.
                  </div>
                  <div className="max-w-[82%] self-start rounded-2xl rounded-bl-[4px] border border-[#d9ddd6] bg-white px-[0.9em] py-[0.65em] text-[0.92rem] leading-[1.5] text-[#12191a] dark:border-[#24322d] dark:bg-[#101917] dark:text-[#eef3ef]">
                    Perfeito, pode mandar
                  </div>
                  <div
                    className="mt-1 flex items-center gap-[0.6em] self-center rounded-full border border-dashed border-[#d9ddd6] bg-white px-4 py-2 text-[0.76rem] text-[#54635e] dark:border-[#24322d] dark:bg-[#101917] dark:text-[#9fb0aa]"
                    style={{ fontFamily: FONT_MONO }}
                  >
                    <Dot tone="money" />
                    Hotmart · pix aprovado ·{" "}
                    <b className="font-semibold text-[#b8711c] dark:text-[#e8a752]">R$ 197,00</b>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* proposta */}
          <section className="border-t border-[#e6e9e3] py-[clamp(56px,8vw,104px)] dark:border-[#1a2622]">
            <p className={EYEBROW}>O que é</p>
            <p className="mt-[0.9em] max-w-[70ch] text-[1.2rem] leading-[1.68] text-[#12191a] dark:text-[#eef3ef]">
              Prime Chat é o{" "}
              <strong className="font-semibold text-[#086b53] dark:text-[#56d9af]">
                CRM de atendimento e automação de vendas por WhatsApp
              </strong>{" "}
              feito pra operações de infoproduto e direct response que vendem com time de vendedores/closers. Ele centraliza
              inbox, fluxo de automação e entrada de vendas de qualquer checkout num único sistema — testado em produção
              todos os dias, não em teoria.
            </p>
          </section>

          {/* pra quem é */}
          <section
            ref={praQuemESection.ref}
            style={revealStyle(praQuemESection.visible)}
            className="border-t border-[#e6e9e3] py-[clamp(56px,8vw,104px)] dark:border-[#1a2622]"
          >
            <div className="mb-[clamp(28px,4vw,44px)] flex max-w-[640px] flex-col gap-3">
              <p className={EYEBROW}>Pra quem é</p>
              <h2
                className="text-balance text-[clamp(1.6rem,3vw,2.2rem)] text-[#12191a] dark:text-[#eef3ef]"
                style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}
              >
                Feito pra quem vende com time, não sozinho
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <FeatureCard
                index={0}
                icon="speech"
                title="Time com vendedor/closer dedicado"
                text="Não é ferramenta de atendimento solo. Foi construído pra operação com mais de uma pessoa vendendo, cada um com o próprio funil de leads."
              />
              <FeatureCard
                index={1}
                icon="flow"
                title="Vende por checkout de terceiro"
                text="Hotmart, Kiwify, Eduzz e qualquer um dos outros 9 — se a venda não nasce dentro do sistema, o Prime Chat foi pensado pra ela entrar de fora pra dentro."
              />
              <FeatureCard
                index={2}
                icon="shield"
                title="Já rodou automação e teve medo de perder o número"
                text="Se seu time hoje evita mandar mensagem em volume por medo de ban, é exatamente o problema que o anti-ban e a variação de mensagem do Prime Chat resolvem."
              />
            </div>
          </section>

          {/* como funciona */}
          <section
            id="como-funciona"
            ref={comoFuncionaSection.ref}
            style={revealStyle(comoFuncionaSection.visible)}
            className="border-t border-[#e6e9e3] py-[clamp(56px,8vw,104px)] dark:border-[#1a2622]"
          >
            <div className="mb-[clamp(28px,4vw,44px)] flex max-w-[640px] flex-col gap-3">
              <p className={EYEBROW}>Onde a operação trava</p>
              <h2
                className="text-balance text-[clamp(1.6rem,3vw,2.2rem)] text-[#12191a] dark:text-[#eef3ef]"
                style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}
              >
                Quatro travamentos que custam venda — e o que o Prime Chat faz em cada um
              </h2>
            </div>
            <div className="flex flex-col gap-5">
              <FlowCard
                index={0}
                dorTag="O travamento"
                dorTitle="Venda escapa porque ninguém lançou na planilha"
                dorText="Toda venda passa por WhatsApp, mas o registro dela vive numa planilha que alguém esquece de atualizar."
                solTag="Como o Prime Chat resolve"
                solContent={
                  <>
                    Webhook nativo pra {PLATAFORMAS.slice(0, -1).map((p) => (
                      <Tag key={p}>{p}</Tag>
                    ))}{" "}
                    e <Tag>{PLATAFORMAS[PLATAFORMAS.length - 1]}</Tag> — mesma URL pra todas. A venda entra sozinha, e cada
                    evento (pix gerado, aprovado, reembolso, chargeback) já pode disparar um fluxo automático.
                  </>
                }
              />
              <FlowCard
                index={1}
                dorTag="O travamento"
                dorTitle="Medo de tomar ban mandando a mesma mensagem pra base inteira"
                dorText="Automação de WhatsApp em volume é a forma mais rápida de perder um número."
                solTag="Como o Prime Chat resolve"
                solContent={
                  <>
                    Cada mensagem do fluxo pode ter várias versões cadastradas, e o sistema sorteia qual envia a cada
                    disparo. Isso roda em cima da{" "}
                    <strong className="font-semibold text-[#086b53] dark:text-[#56d9af]">API oficial do WhatsApp Business</strong>{" "}
                    — não número de terceiro instável — com monitoramento de saúde e qualidade por conta.
                  </>
                }
              />
              <FlowCard
                index={2}
                dorTag="O travamento"
                dorTitle="Ficar refém da aprovação da Meta pra conectar um número novo"
                dorText="Escalar atendimento trava esperando revisão de app na Meta."
                solTag="Como o Prime Chat resolve"
                solContent={
                  <>
                    Cada operação conecta o próprio app Meta via{" "}
                    <strong className="font-semibold text-[#086b53] dark:text-[#56d9af]">OAuth</strong> e começa a usar na
                    hora, sem fila de aprovação.
                  </>
                }
              />
              <FlowCard
                index={3}
                dorTag="O travamento"
                dorTitle="Lead esfria porque o follow-up depende de alguém lembrar de mandar mensagem"
                dorText="Sem automação, o ritmo de contato depende da memória do vendedor — e lead esquecido é venda perdida."
                solTag="Como o Prime Chat resolve"
                solContent={
                  <>
                    Construtor de fluxo visual (mensagem, espera, condição, botão interativo, botão com link, agente de IA,
                    etiqueta automática, blacklist, timeout de "sem resposta") monta a régua de follow-up uma vez e ela roda
                    sozinha pra cada lead novo.
                  </>
                }
              />
            </div>
          </section>

          {/* prova */}
          <section
            id="prova"
            ref={provaSection.ref}
            style={revealStyle(provaSection.visible)}
            className="border-t border-[#e6e9e3] py-[clamp(56px,8vw,104px)] dark:border-[#1a2622]"
          >
            <div className="flex flex-col gap-[22px] rounded-[22px] bg-[#101c18] p-[clamp(28px,5vw,52px)] text-[#eef3ef] dark:bg-[#18302a]">
              <p className={EYEBROW_ON_DARK}>
                <Dot />
                Em produção agora
              </p>
              <p className="max-w-[70ch] text-[1.06rem] leading-[1.7] text-[#eef3ef]">
                O Prime Chat não nasceu pra ser vendido. Nasceu pra rodar a própria operação comercial de quem construiu —
                mais de uma marca, entre infoproduto e direct response. É o motor comercial dessas operações hoje, todos os
                dias, com vendas reais passando por ele. Não é uma feature de slide — é a ferramenta que o próprio criador
                usa pra faturar.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Chip name="Infoproduto" desc="Time de vendedores/closers" />
                <Chip name="Direct response" desc="Quiz → WhatsApp → venda" />
                <span className="ml-1 flex items-center" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <PersonIcon
                      key={i}
                      className={`h-6 w-6 rounded-full border-2 border-[#101c18] bg-[#101c18] text-[#7fe3bf] dark:border-[#18302a] dark:bg-[#18302a] ${i > 0 ? "-ml-2" : ""}`}
                    />
                  ))}
                </span>
              </div>
            </div>
            <div className="mt-[clamp(28px,4vw,44px)] flex flex-col items-center gap-3 text-center">
              <p className="text-[0.98rem] font-medium text-[#12191a] dark:text-[#eef3ef]">
                Veja funcionando na sua operação
              </p>
              <button className={`${BTN} ${BTN_PRIMARY} ${BTN_SM}`} onClick={() => navigate("/teste-gratis")}>
                Teste grátis
              </button>
            </div>
          </section>

          {/* recursos */}
          <section
            id="recursos"
            ref={recursosSection.ref}
            style={revealStyle(recursosSection.visible)}
            className="border-t border-[#e6e9e3] py-[clamp(56px,8vw,104px)] dark:border-[#1a2622]"
          >
            <div className="mb-[clamp(28px,4vw,44px)] flex max-w-[640px] flex-col gap-3">
              <p className={EYEBROW}>Recursos</p>
              <h2
                className="text-balance text-[clamp(1.6rem,3vw,2.2rem)] text-[#12191a] dark:text-[#eef3ef]"
                style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}
              >
                O que roda por baixo
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FeatureCard
                index={0}
                title="Inbox de WhatsApp, multi-conta"
                text="WhatsApp Cloud API oficial, várias contas numa operação só. Times com papéis definidos (dono, gerente, disparo, chat, somente-leitura) — vendedor vê só o que é dele, gerente vê tudo."
              />
              <FeatureCard
                index={1}
                title="Construtor de fluxo visual"
                text='Mensagem, espera, condição, botões interativos, botão com link, agente de IA, etiqueta automática, blacklist, "sem resposta" com timeout. Monta sem código. Inclui geração de PDF dinâmico dentro do fluxo — o texto do lead vira documento personalizado na hora, sem template fixo.'
              />
              <FeatureCard
                index={2}
                title="Vendas automáticas, de qualquer checkout"
                text="Webhook nativo pra 12+ plataformas com a mesma URL. Importação de planilha e lançamento manual quando a venda não vem por webhook."
              />
              <FeatureCard
                index={3}
                title="Infraestrutura que não depende de sorte"
                text="API oficial do WhatsApp Business, conexão via próprio app Meta (OAuth, sem espera de revisão), monitoramento de saúde/qualidade por conta, resposta automática e agente de IA nos fluxos."
              />
            </div>
            <div className="mt-[clamp(28px,4vw,44px)] flex flex-col items-center gap-3 text-center">
              <p className="text-[0.98rem] font-medium text-[#12191a] dark:text-[#eef3ef]">
                Veja funcionando na sua operação
              </p>
              <button className={`${BTN} ${BTN_PRIMARY} ${BTN_SM}`} onClick={() => navigate("/teste-gratis")}>
                Teste grátis
              </button>
            </div>
          </section>

          {/* objeções */}
          <section
            id="objecoes"
            ref={objecoesSection.ref}
            style={revealStyle(objecoesSection.visible)}
            className="border-t border-[#e6e9e3] py-[clamp(56px,8vw,104px)] dark:border-[#1a2622]"
          >
            <div className="mb-[clamp(28px,4vw,44px)] flex max-w-[640px] flex-col gap-3">
              <p className={EYEBROW}>Antes de você perguntar</p>
              <h2
                className="text-balance text-[clamp(1.6rem,3vw,2.2rem)] text-[#12191a] dark:text-[#eef3ef]"
                style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}
              >
                Objeções, respondidas direto
              </h2>
            </div>
            <div className="flex flex-col gap-3">
              <Objection
                index={0}
                q="“Meu time já usa outro CRM.”"
                a="Você não precisa migrar tudo de uma vez. O webhook de venda usa a mesma URL das 12+ plataformas — pluga no seu checkout atual em minutos. Dá pra rodar o WhatsApp e as vendas no Prime Chat enquanto o resto do processo continua como está, e importar histórico de leads/vendas por planilha quando fizer sentido trocar de vez."
              />
              <Objection
                index={1}
                q="“Tenho medo de automação de WhatsApp banir meu número.”"
                a="É exatamente o risco que o Prime Chat foi construído pra reduzir: variação de mensagem sorteia entre versões diferentes do mesmo texto pra não repetir padrão, cada conta tem monitoramento de saúde e qualidade, e tudo roda na API oficial da Meta — não em número de terceiro instável. É o mesmo tipo de número que sustenta operação comercial real rodando todo dia."
              />
              <Objection
                index={2}
                q="“Isso parece complexo demais pro meu time implementar.”"
                a="É a mesma ferramenta que hoje roda a operação comercial do Roger, com vendedor, gerente e disparo trabalhando nela. O fluxo é visual, sem código, e a conexão do WhatsApp é por OAuth direto — sem depender de aprovação externa pra começar."
              />
              <Objection
                index={3}
                q="“Já uso Make/n8n pra automatizar meu WhatsApp e conectar meu checkout.”"
                a="Isso resolve a automação, mas deixa você montando por fora a ponte entre canal de vendas e ferramenta de automação — com risco de quebrar a cada mudança de API. No Prime Chat o webhook de checkout, o fluxo de mensagens e o inbox de atendimento já nascem conectados no mesmo lugar, sem manutenção de integração por fora."
              />
            </div>
          </section>

          {/* cta final */}
          <section id="teste" className="flex flex-col items-center gap-4 border-t border-[#e6e9e3] py-[clamp(56px,8vw,104px)] text-center dark:border-[#1a2622]">
            <p className={EYEBROW}>Pronto pra rodar sua operação</p>
            <h2
              className="max-w-[22ch] text-balance text-[clamp(1.7rem,3.4vw,2.5rem)] text-[#12191a] dark:text-[#eef3ef]"
              style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}
            >
              Mesmo sistema que já roda operação comercial de verdade, disponível pra sua operação de WhatsApp.
            </h2>
            <div className="flex flex-wrap justify-center gap-3.5">
              <button className={`${BTN} ${BTN_PRIMARY}`} onClick={() => navigate("/teste-gratis")}>
                Teste grátis
              </button>
              <a className={`${BTN} ${BTN_GHOST}`} href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                Falar com o time
              </a>
            </div>
            <TrustBadge compact />
            <p className="text-[0.78rem] text-[#54635e] opacity-75 dark:text-[#9fb0aa]" style={{ fontFamily: FONT_MONO }}>
              "Falar com o time" abre WhatsApp com número placeholder — troque pelo real na publicação.
            </p>
          </section>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6e9e3] py-8 text-[0.86rem] text-[#54635e] dark:border-[#1a2622] dark:text-[#9fb0aa]">
          <div className="flex items-center gap-[0.55em] text-[0.9rem]" style={{ fontFamily: FONT_MONO }}>
            <Dot />
            Prime Chat
          </div>
          <span>Já em produção real</span>
        </footer>
      </div>
    </div>
  );
}
