import { Notice } from "@/admin/ui/notice";
import { Button } from "@/components/ui/button";

interface DraftRestoredNoticeProps {
  /** Tira lo recuperado: el formulario vuelve a como estaba antes. */
  onDiscard: () => void;
  className?: string;
}

/** El aviso de arriba de un formulario que volvió a llenarse después de que la sesión se cerró. */
export function DraftRestoredNotice({ onDiscard, className }: DraftRestoredNoticeProps) {
  return (
    <Notice tone="info" className={className}>
      <div data-testid="draft-notice" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p>Tu sesión se cerró por inactividad: recuperamos lo que habías escrito, revisalo y guardá.</p>
        <Button type="button" variant="ink-outline" size="sm" onClick={onDiscard}>
          Descartar
        </Button>
      </div>
    </Notice>
  );
}
