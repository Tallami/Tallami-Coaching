import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { Meter, type MeterTone } from "@/admin/charts/meter";
import { formatDay } from "@/admin/dates";
import { formatPercent } from "@/admin/overview/labels";
import { monotributoVerdict } from "@/admin/overview/monotributo-verdict";
import type { OverviewData } from "@/admin/overview/overview-data";
import { SectionCard } from "@/admin/overview/section-card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const CONFIGURATION_HREF = "/admin/configuracion";

const TONE_TEXT: Record<MeterTone, string> = {
  accent: "text-ok-ink",
  warn: "text-warn-ink",
  danger: "text-danger-ink",
};

/**
 * Los ingresos en pesos de los últimos 12 meses móviles contra el tope anual
 * de la categoría. Suma lo cobrado (por fecha de cobro) y compara con el tope
 * que cargó Tallami: no lo verifica con ARCA ni reemplaza al contador.
 */
export function MonotributoCard({ data }: { data: OverviewData }) {
  const { status, settings, window } = data.monotributo;
  const description = `Lo cobrado del ${formatDay(window.from)} al ${formatDay(window.to)} (hoy), por fecha de cobro.`;

  if (!settings || status.usedPct === null || status.remainingArsMinor === null || status.capArsMinor === null) {
    return (
      <SectionCard id="monotributo" testId="monotributo" title="Monotributo" description={description}>
        <p className="text-[0.9375rem] text-ink-2">Cobrado en los últimos 12 meses</p>
        <p className="text-[1.75rem] leading-tight font-extrabold tabular-nums">
          {formatMoney(status.last12ArsMinor, "ARS")}
        </p>
        <p className="mt-3 max-w-prose text-ink-2">
          Todavía no cargaste tu categoría ni el tope anual. Con eso, acá ves qué parte del tope llevás usada y cuánto
          te queda.
        </p>
        <div className="mt-4">
          <Button asChild variant="ink-outline" size="sm">
            <Link href={CONFIGURATION_HREF}>Cargar categoría y tope</Link>
          </Button>
        </div>
      </SectionCard>
    );
  }

  const { tone, text } = monotributoVerdict(status.usedPct, status.remainingArsMinor);
  const Icon = tone === "accent" ? CircleCheckIcon : TriangleAlertIcon;
  return (
    <SectionCard id="monotributo" testId="monotributo" title="Monotributo" description={description}>
      <p className="flex items-baseline gap-2">
        <span className="text-[clamp(2.5rem,5vw,3.25rem)] leading-none font-extrabold [font-stretch:75%]">
          {formatPercent(status.usedPct)}
        </span>
        <span className="text-ink-2">del tope usado</span>
      </p>
      <Meter
        className="mt-3"
        usedPct={status.usedPct}
        tone={tone}
        label="Tope anual del monotributo usado"
        valueText={`${formatPercent(status.usedPct)} del tope`}
      />
      <p className={cn("mt-3 flex items-start gap-2 font-bold", TONE_TEXT[tone])}>
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        {text}
      </p>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-rule pt-3 text-[0.9375rem]">
        <dt className="text-ink-2">Cobrado en 12 meses</dt>
        <dd className="text-right font-bold tabular-nums">{formatMoney(status.last12ArsMinor, "ARS")}</dd>
        <dt className="text-ink-2">Tope, categoría {settings.category}</dt>
        <dd className="text-right font-bold tabular-nums">{formatMoney(status.capArsMinor, "ARS")}</dd>
      </dl>
      <p className="mt-3 text-[0.875rem] leading-snug text-ink-2">
        El tope es lo que cargaste en{" "}
        <Link href={CONFIGURATION_HREF} className="font-semibold underline underline-offset-2">
          Configuración
        </Link>{" "}
        (categoría {settings.category}, vigente desde el {formatDay(settings.validFrom)}); el panel no lo compara con
        ARCA. Confirmalo con tu contador.
      </p>
    </SectionCard>
  );
}
