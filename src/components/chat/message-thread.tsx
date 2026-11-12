import type { ChatMessage } from "@/chat/conversations";
import type { MessageSender } from "@/chat/policy";
import { LocalTime } from "./local-time";

export interface MessageThreadLabels {
  /** Cómo se llama quien mira: "Vos" en el portal, "Vos" o "Tallami" en el panel. */
  own: string;
  /** Cómo se llama el otro lado. */
  other: string;
  /** Lo que se dice cuando todavía no hay mensajes. */
  empty: string;
  /** El nombre de la conversación para los lectores de pantalla; por defecto, el del otro lado. */
  thread?: string;
}

interface MessageThreadProps {
  /** Del más viejo al más nuevo, como los devuelve `listMessages`. */
  messages: readonly ChatMessage[];
  /** Quién mira: sus mensajes van a la derecha y los del otro, a la izquierda. */
  viewer: MessageSender;
  labels: MessageThreadLabels;
  /** Una zona fija para las horas (el panel pasa la de Argentina); sin ella, la del navegador. */
  timeZone?: string;
  /** El idioma de las horas (BCP 47). Por defecto, el español de Argentina del panel. */
  locale?: string;
}

/**
 * La conversación, del mensaje más viejo al más nuevo. Los de quien mira van a la derecha, en papel con
 * el filo de tinta; los del otro, a la izquierda, sobre el escenario con el filo dorado. El texto de un
 * mensaje es siempre texto de React: nada se interpreta como HTML ni se vuelve un link.
 *
 * Cuando es larga, la conversación se desplaza dentro de su caja y el formulario queda debajo, a la vista.
 * La caja va en `column-reverse`: el navegador la abre ya abajo, en lo último, también sin JavaScript, y
 * se queda abajo cuando llega un mensaje nuevo. Es un `log` (lo que llega se anuncia) y se puede enfocar
 * para desplazarla con el teclado.
 */
export function MessageThread({ messages, viewer, labels, timeZone, locale = "es-AR" }: MessageThreadProps) {
  if (messages.length === 0) {
    return <p className="m-0 border-t-4 border-ink bg-white/60 p-[clamp(18px,3.5vw,28px)] text-ink-2">{labels.empty}</p>;
  }

  return (
    <div
      role="log"
      aria-label={labels.thread ?? labels.other}
      tabIndex={0}
      className="flex max-h-[min(58svh,44rem)] flex-col-reverse overflow-y-auto overscroll-contain border-t-4 border-ink bg-white/60 px-[clamp(12px,3vw,24px)] py-[clamp(14px,3vw,24px)]"
    >
      <ol role="list" className="m-0 flex list-none flex-col gap-4 p-0">
        {messages.map((message) => {
          const isOwn = message.sender === viewer;
          return (
            <li key={message.id} className={`flex min-w-0 ${isOwn ? "justify-end" : "justify-start"}`}>
              <div
                className={`min-w-0 max-w-[min(86%,36rem)] rounded-[4px] px-4 py-3 ${
                  isOwn ? "border border-r-4 border-rule border-r-ink bg-white text-ink" : "stage border-l-4 border-gold"
                }`}
              >
                <p className={`m-0 flex flex-wrap items-baseline gap-x-2.5 text-[.85rem] ${isOwn ? "justify-end text-ink-2" : "text-on-stage-2"}`}>
                  <span className={`font-bold font-stretch-90% ${isOwn ? "text-ink" : "text-gold"}`}>{isOwn ? labels.own : labels.other}</span>
                  <LocalTime iso={message.createdAt} locale={locale} timeZone={timeZone} />
                </p>
                <p className="m-0 mt-1.5 whitespace-pre-wrap leading-snug [overflow-wrap:anywhere]">{message.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
