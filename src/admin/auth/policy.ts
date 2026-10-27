// Los tiempos y los límites de la seguridad del ingreso al panel, en un solo
// lugar. El resto del código (sesiones, ingresos a medio camino, llaves de
// acceso, códigos para otro dispositivo) los lee de acá: cambiar uno es cambiar
// una línea.

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Una sesión sin uso se cierra sola a los 30 minutos. */
export const SESSION_IDLE_MS = 30 * MINUTE_MS;
/** Y dura como máximo 8 horas desde el ingreso, por más que se use. */
export const SESSION_MAX_MS = 8 * HOUR_MS;
/** El último uso de una sesión se anota como mucho una vez por minuto. */
export const SESSION_TOUCH_INTERVAL_MS = MINUTE_MS;

/** Tiempo para completar el segundo paso después de la contraseña. */
export const PENDING_LOGIN_MS = 5 * MINUTE_MS;
/** Vida de un desafío WebAuthn (un solo uso). */
export const CHALLENGE_MS = 5 * MINUTE_MS;
/** Hasta cuándo vale haber confirmado con la llave para las acciones delicadas. */
export const REAUTH_WINDOW_MS = 5 * MINUTE_MS;

/** El código para sumar otro dispositivo vence a los 10 minutos (un solo uso). */
export const ENROLLMENT_CODE_MS = 10 * MINUTE_MS;
export const ENROLLMENT_CODE_LENGTH = 10;
/** Sin las letras y los números que se confunden entre sí (I, O, 0, 1). */
export const ENROLLMENT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * El aviso por email de un bloqueo sale como mucho una vez por hora, sea de la conexión que
 * sea. No es la ventana de 15 minutos de los intentos: con un ataque sostenido serían unos 96
 * emails por día y el plan gratis de Resend (100 por día) se agotaría, y los avisos que sí
 * importan (una primera llave, una llave agregada) dejarían de salir.
 */
export const LOGIN_BLOCKED_ALERT_WINDOW_MS = HOUR_MS;

/** Los registros de sesiones se borran a los 30 días. */
export const SESSION_RETENTION_MS = 30 * DAY_MS;
/** Los ingresos a medio camino y los códigos se borran un día después de vencer. */
export const AUTH_RECORD_RETENTION_MS = DAY_MS;

/** Largo del nombre que se le da a una llave: de 1 a 40 caracteres. */
export const PASSKEY_NAME_MAX_LENGTH = 40;
