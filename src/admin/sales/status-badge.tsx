import type { ComponentProps } from "react";
import {
  INVOICE_STATUS_LABELS,
  STATUS_LABELS,
  type InvoiceStatus,
  type SaleStatus,
} from "@/admin/catalog";
import { Badge } from "@/components/ui/badge";

type Tone = NonNullable<ComponentProps<typeof Badge>["variant"]>;

/** Pendiente = dorado (hay que hacer algo), cobrada = verde, entregada = azul, reembolsada = rojo. */
const SALE_STATUS_TONE: Record<SaleStatus, Tone> = {
  pending: "warn",
  paid: "ok",
  delivered: "info",
  cancelled: "neutral",
  refunded: "danger",
};

const INVOICE_STATUS_TONE: Record<InvoiceStatus, Tone> = {
  pending: "outline",
  issued: "ok",
  not_required: "neutral",
};

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return <Badge variant={SALE_STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge variant={INVOICE_STATUS_TONE[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>;
}
