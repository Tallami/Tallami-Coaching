import { formatMoment } from "@/admin/dates";
import type { SaleRow } from "@/admin/sales/repository";

/**
 * Los códigos de replay que mandó el alumno al comprar un VOD review. Es texto que escribió una
 * persona: React lo escapa y `whitespace-pre-wrap` respeta sus saltos de línea. Sin códigos, no se muestra.
 */
export function ReplayCodesCard({ sale }: { sale: Pick<SaleRow, "replayCodes" | "replayCodesSentAt"> }) {
  if (sale.replayCodes === null) return null;
  const headingId = "replay-codes-heading";
  return (
    <section aria-labelledby={headingId} className="mb-6 border-2 border-ink border-l-[6px] border-l-zone bg-white px-5 py-4">
      <h2 id={headingId} className="text-[1.25rem] leading-tight font-extrabold [font-stretch:75%]">
        Códigos de replay
      </h2>
      {sale.replayCodesSentAt ? (
        <p className="mt-1 text-[0.875rem] text-ink-2">Los mandó el alumno el {formatMoment(sale.replayCodesSentAt)}.</p>
      ) : null}
      <pre data-testid="replay-codes" className="mt-3 font-mono text-[0.9375rem] break-words whitespace-pre-wrap">
        {sale.replayCodes}
      </pre>
    </section>
  );
}
