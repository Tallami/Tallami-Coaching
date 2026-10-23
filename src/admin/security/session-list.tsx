import { Badge } from "@/components/ui/badge";

/** Una sesión abierta tal como se muestra: las fechas ya vienen escritas en hora de Argentina. */
export interface SessionRow {
  id: string;
  /** El navegador y el sistema ("Chrome en Windows"). */
  device: string;
  startedAt: string;
  lastSeenAt: string;
  /** La sesión de este navegador. */
  isCurrent: boolean;
}

interface SessionListProps {
  sessions: SessionRow[];
}

/** Las sesiones abiertas: dispositivo, cuándo empezaron y cuándo se usaron por última vez. La de este navegador va marcada. */
export function SessionList({ sessions }: SessionListProps) {
  return (
    <ul className="flex flex-col">
      {sessions.map((session) => (
        <li key={session.id} className="border-b border-rule py-3 first:pt-0 last:border-b-0 last:pb-0">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-bold">
            <span className="break-words">{session.device}</span>
            {session.isCurrent ? <Badge variant="info">Esta sesión</Badge> : null}
          </p>
          <p className="text-[0.9375rem] leading-snug text-ink-2">
            Inició el {session.startedAt} · Último uso: {session.lastSeenAt}
          </p>
        </li>
      ))}
    </ul>
  );
}
