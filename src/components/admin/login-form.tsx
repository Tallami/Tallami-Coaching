import type { LoginErrorCode } from "@/admin/auth/login-errors";
import { Monogram } from "@/admin/ui/monogram";
import { SubmitButton } from "@/components/admin/submit-button";

interface LoginFormProps {
  action: (formData: FormData) => Promise<void>;
  error: LoginErrorCode | null;
  /** A dónde volver después de entrar (ya validado: una ruta del panel). */
  next: string;
}

/** Siempre el mismo texto ante una contraseña mala: no dice qué está configurado y qué no. */
const ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  invalid: "Contraseña incorrecta.",
  blocked: "Demasiados intentos fallidos. Probá de nuevo en 15 minutos.",
  unavailable: "No pudimos verificar el ingreso. Probá de nuevo en unos minutos.",
};

const ERROR_ID = "login-error";

export function LoginForm({ action, error, next }: LoginFormProps) {
  return (
    <main className="stage grid min-h-dvh place-items-center px-gutter py-12">
      <div className="w-full max-w-sm border-t-[6px] border-gold bg-paper p-8 text-ink">
        <Monogram />
        <h1 className="mt-5 text-3xl font-extrabold leading-tight">Panel de Tallami</h1>
        <p className="mt-1 text-ink-2">Acceso privado.</p>

        <form action={action} className="mt-8 flex flex-col gap-5">
          <input type="hidden" name="next" value={next} />
          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="font-bold">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              maxLength={1024}
              aria-invalid={error === "invalid" ? true : undefined}
              aria-describedby={error ? ERROR_ID : undefined}
              className="min-h-12 rounded-[4px] border-2 border-ink bg-white/70 px-3 text-[1rem]"
            />
          </div>
          {error ? (
            <p
              id={ERROR_ID}
              role="alert"
              className="border-l-4 border-[#a4261c] bg-[#a4261c]/10 px-3 py-2 text-[0.95rem] font-semibold text-[#7a1b14]"
            >
              {ERROR_MESSAGES[error]}
            </p>
          ) : null}
          <SubmitButton pendingLabel="Ingresando…">Ingresar</SubmitButton>
        </form>
      </div>
    </main>
  );
}
