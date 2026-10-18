import { Notice } from "@/admin/ui/notice";

/**
 * Lo que se lee cuando el navegador tiene JavaScript apagado, en los formularios
 * cuyo botón de guardar espera a que la página esté lista (`useHydrated`): sin
 * JavaScript ese botón queda desactivado y la persona no sabría por qué. Con
 * JavaScript, el navegador ni lo dibuja.
 */
export function NoScriptNote() {
  return (
    <noscript>
      <Notice tone="info">Activá JavaScript para guardar.</Notice>
    </noscript>
  );
}
