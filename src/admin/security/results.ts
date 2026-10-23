// Lo que contestan las acciones de Configuración → Seguridad
// (`src/app/admin/configuracion/seguridad/actions.ts`), en un archivo aparte porque
// un archivo `"use server"` solo puede exportar funciones y los componentes del
// navegador también necesitan los tipos. Todas contestan con `ok`; el motivo de un
// fallo es un código corto que la pantalla traduce a un aviso en español.

import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

/**
 * Las acciones delicadas piden haber confirmado con la llave hace menos de 5 minutos
 * (`hasRecentReauth`). Si no, no hacen nada y contestan esto: el navegador confirma
 * (`withReauth`) y repite el pedido.
 */
export type ReauthRequired = { ok: false; error: "reauth-required" };

/** El nombre de la llave no sirve (vacío o de más de 40 caracteres). */
export type InvalidName = { ok: false; error: "invalid-name" };

export type BeginReauthResult =
  | { ok: true; options: PublicKeyCredentialRequestOptionsJSON }
  /** No hay con qué confirmar: no hay ninguna llave registrada. */
  | { ok: false; error: "failed" };

export type FinishReauthResult =
  | { ok: true }
  /** `expired`: no había un desafío vivo (venció, ya se usó o nunca se pidió). `failed`: la llave no verifica. */
  | { ok: false; error: "expired" | "failed" };

export type BeginAddPasskeyResult =
  | { ok: true; options: PublicKeyCredentialCreationOptionsJSON }
  | ReauthRequired;

export type FinishAddPasskeyResult =
  | { ok: true }
  | ReauthRequired
  | InvalidName
  /** `expired`: no había un desafío vivo. `failed`: el registro no verifica, o esa llave ya estaba registrada. */
  | { ok: false; error: "expired" | "failed" };

export type RenamePasskeyResult =
  | { ok: true }
  | ReauthRequired
  | InvalidName
  | { ok: false; error: "missing" };

export type DeletePasskeyResult =
  /** `redirectTo` solo si se borró la llave de la sesión actual: también se cerró, hay que volver al login. */
  | { ok: true; redirectTo?: string }
  | ReauthRequired
  /** `last`: la última llave no se borra. */
  | { ok: false; error: "last" | "missing" };

export type EnrollmentCodeResult =
  /** El código ya formateado ("ABCDE-FGHJK") y cuándo vence (ISO). Es la única vez que se ve. */
  | { ok: true; code: string; expiresAt: string }
  | ReauthRequired;

export type CloseAllSessionsResult = { ok: true; redirectTo: string } | ReauthRequired;
