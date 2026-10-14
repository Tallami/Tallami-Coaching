import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type NoticeTone = "ok" | "error" | "info";

interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  id?: string;
  className?: string;
}

/**
 * El rol sigue al tono: un error se anuncia enseguida (`alert`); una
 * confirmación o un dato, con calma (`status`).
 */
const ROLE: Record<NoticeTone, "alert" | "status"> = {
  ok: "status",
  error: "alert",
  info: "status",
};

const TONE_CLASSES: Record<NoticeTone, string> = {
  ok: "border-ok-ink bg-ok-tint text-ok-ink",
  error: "border-danger bg-danger-tint text-danger-ink",
  info: "border-info-ink bg-info-tint text-info-ink",
};

/** Aviso corto con una barra de color a la izquierda: confirma, avisa de un error o informa. */
export function Notice({ tone, children, id, className }: NoticeProps) {
  return (
    <div
      id={id}
      role={ROLE[tone]}
      className={cn("border-l-4 px-4 py-3 font-semibold", TONE_CLASSES[tone], className)}
    >
      {children}
    </div>
  );
}
