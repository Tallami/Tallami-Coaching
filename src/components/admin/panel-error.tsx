import { Monogram } from "@/admin/ui/monogram";
import { Button } from "@/components/ui/button";

interface PanelErrorProps {
  /** Vuelve a pedirle los datos al servidor y a armar la pantalla (`retry` de Next). */
  retry: () => void;
  /** El ingreso, con `?next=` si se sabe dónde estaba el visitante (ya validado: una ruta del panel). */
  loginHref: string;
}

/**
 * Lo que se ve cuando una pantalla del panel o una acción falla sin que el código
 * lo haya previsto: una sesión vencida a mitad de una carga, un corte de la base.
 * Reemplaza la página de error de Next, que está en inglés. No muestra el error:
 * ni su mensaje, ni su traza, ni su código (en el servidor ya quedó registrado).
 *
 * El enlace al ingreso es un enlace común y no un `Link`: una carga completa deja
 * la pantalla sin nada del estado que falló.
 */
export function PanelError({ retry, loginHref }: PanelErrorProps) {
  return (
    <main className="stage grid min-h-dvh place-items-center px-gutter py-12">
      <div role="alert" className="w-full max-w-lg border-t-[6px] border-gold bg-paper p-8 text-ink">
        <Monogram />
        <h1 className="mt-5 text-3xl font-extrabold leading-tight">Algo salió mal</h1>
        <p className="mt-3 text-ink-2">
          No pudimos completar lo que estabas haciendo. Puede que se haya vencido tu sesión o que haya un
          problema momentáneo.
        </p>
        <p className="mt-3 text-ink-2">
          Lo último que cargaste puede que no se haya guardado: revisalo antes de volver a cargarlo.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button type="button" onClick={retry}>
            Volver a intentar
          </Button>
          <Button asChild variant="ink-outline">
            <a href={loginHref}>Ir al ingreso</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
