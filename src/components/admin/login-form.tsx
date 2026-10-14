import type { LoginErrorCode } from "@/admin/auth/login-errors";
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

function Monogram() {
  return (
    <svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">
      <rect width="64" height="64" rx="11.52" fill="#0B1433" />
      <path fill="#F3F5FA" d="M13.5 11h34v12H36.5v30h-12V23h-11z" />
      <rect x="40.5" y="43" width="10" height="10" fill="#FFC93C" />
    </svg>
  );
}

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
