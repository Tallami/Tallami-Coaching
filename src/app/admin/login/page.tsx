import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMissingConfig } from "@/admin/auth/config";
import { parseLoginError } from "@/admin/auth/login-errors";
import { SETUP_PATH, safeNextPath } from "@/admin/auth/redirect";
import { hasAdminSession } from "@/admin/auth/require-admin";
import { firstValue } from "@/admin/ui/search-params";
import { LoginForm } from "@/components/admin/login-form";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage(props: PageProps<"/admin/login">) {
  const { error, next } = await props.searchParams;

  if (getMissingConfig().length > 0) redirect(SETUP_PATH);
  const destination = safeNextPath(firstValue(next));
  // Con la sesión ya iniciada no tiene sentido pedir la contraseña de nuevo.
  if (await hasAdminSession()) redirect(destination);

  return (
    <LoginForm
      action={loginAction}
      error={parseLoginError(firstValue(error))}
      next={destination}
    />
  );
}
