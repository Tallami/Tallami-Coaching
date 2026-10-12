"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from "react";
import styles from "./marquee.module.css";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** Lo que el teclado puede enfocar dentro de una fila. */
const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
/**
 * Al reubicar una fila que va hacia la derecha no se usa el último milisegundo
 * de la vuelta: ese instante es el comienzo de la siguiente y dejaría la copia
 * del loop en el lugar del elemento enfocado.
 */
const LOOP_END_MARGIN_MS = 1;
/** Por debajo de medio píxel no vale la pena mover la fila. */
const MIN_SHIFT_PX = 0.5;

/** `paused` del botón del grupo; `null` fuera de un `MarqueeGroup`. */
const MarqueePausedContext = createContext<boolean | null>(null);

export interface MarqueeGroupProps {
  /** Texto del botón mientras se mueve ("Pausar"). */
  pauseLabel: string;
  /** Texto del botón con el movimiento pausado ("Reanudar"). */
  resumeLabel: string;
  /** Nombre accesible del grupo, si la sección que lo contiene no lo nombra. */
  label?: string;
  children: ReactNode;
  className?: string;
}

export interface MarqueeRowProps {
  direction: "left" | "right";
  /** Segundos que tarda una vuelta completa (el ancho de una copia). */
  durationSeconds: number;
  children: ReactNode;
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12">
      <path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12">
      <path d="M2.5 1v10l8.5-5z" fill="currentColor" />
    </svg>
  );
}

/**
 * Grupo de filas en movimiento con un único botón de pausa. Las filas se
 * frenan con el botón, mientras el puntero está sobre alguna y mientras el
 * foco del teclado está adentro del grupo (WCAG 2.2.2). El botón va primero:
 * con el teclado se llega a él antes que a lo que se mueve.
 */
export function MarqueeGroup({
  pauseLabel,
  resumeLabel,
  label,
  children,
  className,
}: MarqueeGroupProps) {
  const [paused, setPaused] = useState(false);

  return (
    <div
      className={className ? `${styles.group} ${className}` : styles.group}
      role={label ? "group" : undefined}
      aria-label={label}
    >
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={paused}
        onClick={() => setPaused((current) => !current)}
      >
        {paused ? <PlayIcon /> : <PauseIcon />}
        {paused ? resumeLabel : pauseLabel}
      </button>
      <MarqueePausedContext value={paused}>{children}</MarqueePausedContext>
    </div>
  );
}

/**
 * Corre la animación de la fila lo justo para que `item` (con su aro de foco)
 * quede entero adentro: la fila está pausada mientras el foco del teclado está
 * en el grupo, y al reanudar sigue desde ahí, sin saltos.
 */
function seekToShow(
  animation: Animation,
  row: HTMLElement,
  track: HTMLElement,
  item: HTMLElement,
  direction: MarqueeRowProps["direction"],
) {
  const duration = animation.effect?.getComputedTiming().duration;
  if (typeof duration !== "number" || duration <= 0) return;

  const rowBox = row.getBoundingClientRect();
  const trackBox = track.getBoundingClientRect();
  const itemBox = item.getBoundingClientRect();
  const { outlineWidth, outlineOffset } = getComputedStyle(item);
  const reach = (parseFloat(outlineWidth) || 0) + (parseFloat(outlineOffset) || 0);
  // La pista lleva dos copias: una vuelta es la mitad de su ancho.
  const loopWidth = trackBox.width / 2;

  // Todo en coordenadas de la pista: cuánto quedó a la izquierda del borde
  // visible y dónde empieza y termina el elemento con su aro.
  const offset = rowBox.left - trackBox.left;
  const start = itemBox.left - trackBox.left - reach;
  const end = itemBox.right - trackBox.left + reach;
  // Lo más cerca posible de donde está; si no entra entero, se ve su comienzo.
  const target = Math.max(0, Math.min(Math.max(offset, end - rowBox.width), start));
  if (Math.abs(target - offset) < MIN_SHIFT_PX) return;

  const progress = target / loopWidth;
  const loopTime = direction === "left" ? progress * duration : (1 - progress) * duration;
  const current = typeof animation.currentTime === "number" ? animation.currentTime : 0;
  const loopStart = Math.floor(current / duration) * duration;

  animation.currentTime = loopStart + Math.min(loopTime, duration - LOOP_END_MARGIN_MS);
}

/**
 * Con "reducir movimiento" la fila no se mueve y se desliza a mano. Si adentro
 * no hay nada que el teclado pueda enfocar (la franja de jugadores), la fila
 * misma se vuelve focusable para poder desplazarla con las flechas.
 */
function useKeyboardScrollStop(
  rowRef: RefObject<HTMLDivElement | null>,
  copyRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const row = rowRef.current;
    const copy = copyRef.current;
    if (!row || !copy) return;

    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => {
      if (media.matches && copy.querySelector(FOCUSABLE) === null) {
        row.tabIndex = 0;
      } else {
        row.removeAttribute("tabindex");
      }
    };

    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [rowRef, copyRef]);
}

/**
 * Una fila en loop: `children` se muestra una vez y se repite en una copia
 * para el loop que no lee el lector de pantalla ni recibe foco
 * (`aria-hidden` + `inert`). El movimiento es una animación CSS (no ocupa el
 * hilo principal); con el foco del teclado en un elemento de la fila, la
 * animación se adelanta o atrasa hasta que ese elemento se ve entero.
 */
export function MarqueeRow({ direction, durationSeconds, children }: MarqueeRowProps) {
  const paused = useContext(MarqueePausedContext);
  const rowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);

  useKeyboardScrollStop(rowRef, copyRef);

  if (paused === null) {
    throw new Error("MarqueeRow tiene que ir dentro de un MarqueeGroup.");
  }

  function revealFocused(event: FocusEvent<HTMLDivElement>) {
    const row = event.currentTarget;
    const track = trackRef.current;
    const item = event.target;
    // Solo el foco del teclado: un clic ya cae en algo visible, y mover la
    // fila entre el `mousedown` y el `mouseup` podría perder ese clic.
    if (!track || item === row || !(item instanceof HTMLElement)) return;
    if (!item.matches(":focus-visible")) return;

    const [animation] = track.getAnimations();
    if (animation) {
      seekToShow(animation, row, track, item, direction);
    } else {
      // Sin movimiento la fila tiene scroll propio.
      item.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  return (
    <div
      ref={rowRef}
      className={styles.row}
      data-direction={direction}
      data-paused={paused || undefined}
      style={{ "--marquee-duration": `${durationSeconds}s` } as CSSProperties}
      onFocus={revealFocused}
    >
      <div ref={trackRef} className={styles.track}>
        <div ref={copyRef} className={styles.copy}>
          {children}
        </div>
        <div className={styles.copy} aria-hidden="true" inert>
          {children}
        </div>
      </div>
    </div>
  );
}
