import type { ConfigProblem, ConfigVariable, MissingConfig } from "@/admin/auth/config";

interface SetupChecklistProps {
  items: readonly MissingConfig[];
}

const PROBLEM_TEXT: Record<ConfigProblem, string> = {
  missing: "Falta.",
  invalid: "No tiene el formato esperado.",
  "too-short": "Es más corta de lo permitido: necesita 32 caracteres o más.",
};

/** Cómo arreglar cada variable. Solo explica: nunca muestra el valor que tenga. */
const HOW_TO_FIX: Record<ConfigVariable, string> = {
  ADMIN_PASSWORD_HASH:
    "Generá el hash con npm run admin:password y cargalo en esta variable.",
  ADMIN_SESSION_SECRET:
    "Usá un texto al azar de 32 caracteres o más (por ejemplo, la salida de openssl rand -base64 48).",
  DATABASE_URL:
    "En Vercel el panel no usa la base local: cargá la URL de conexión de Supabase (pooler de transacciones).",
};

/**
 * Lista de lo que falta configurar para abrir el panel. La página es pública
 * (se necesita justo cuando todavía no se puede entrar), por eso solo nombra
 * las variables y no tiene acceso a sus valores.
 */
export function SetupChecklist({ items }: SetupChecklistProps) {
  return (
    <main className="stage grid min-h-dvh place-items-center px-gutter py-12">
      <div className="w-full max-w-lg border-t-[6px] border-gold bg-paper p-8 text-ink">
        <h1 className="text-3xl font-extrabold leading-tight">
          Falta configurar el panel
        </h1>
        <p className="mt-3 text-ink-2">
          El panel no abre hasta que estas variables de entorno estén cargadas.
          Después de cargarlas, volvé a desplegar.
        </p>
        <ul className="mt-6 flex flex-col gap-4">
          {items.map(({ name, problem }) => (
            <li key={name} className="border-l-4 border-ink pl-4">
              <code className="font-bold">{name}</code>
              <p className="mt-1 text-[0.95rem] text-ink-2">
                {PROBLEM_TEXT[problem]} {HOW_TO_FIX[name]}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
