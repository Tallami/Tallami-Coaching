import type { ProApplicationStatus } from "@/payments/policy";

/** Cómo se llama cada estado de una aplicación en el panel, y de qué color es su insignia. */
export const APPLICATION_STATUS_LABELS: Record<ProApplicationStatus, string> = {
  new: "Nueva",
  talking: "En charla",
  accepted: "Aceptada",
  rejected: "Rechazada",
};

export const APPLICATION_STATUS_BADGES: Record<ProApplicationStatus, "warn" | "info" | "ok" | "neutral"> = {
  new: "warn",
  talking: "info",
  accepted: "ok",
  rejected: "neutral",
};
