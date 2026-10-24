import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { returnPath } from "@/admin/auth/return-path";
import { readFormFields, writeFormFields } from "./draft-fields";
import { getDraftStorage, removeDraft, saveDraft, takeRecoverableDraft, type DraftRecord } from "./draft-store";

// Que lo escrito en un formulario no se pierda si la sesión termina justo al guardar. El gancho:
// - al enviar el formulario, deja en `sessionStorage` un borrador pendiente con lo que tenía;
// - al abrirlo, si hay un borrador pendiente y el login dejó la marca de recuperación después de
//   ese envío (ver `draft-store.ts`), vuelve a llenar los campos y dice `restored: true` para que
//   el formulario avise y ofrezca descartar; si no hay marca, tira el borrador (el envío salió
//   bien o se abandonó).
//
// Los campos se vuelven a poner avisando como lo haría quien escribe (los formularios del panel
// son controlados por React). Un campo puede aparecer recién cuando otro ya tiene su valor
// (la descripción de «Otro», los tipos de cambio manuales): se repite hasta que no cambie nada.

const MAX_RESTORE_PASSES = 5;

export interface FormDraft {
  /** Se recuperó un borrador: el formulario muestra el aviso. */
  restored: boolean;
  /** Borra el borrador y oculta el aviso. Dejar el formulario vacío es del formulario (su estado es suyo). */
  discard: () => void;
}

export function useFormDraft(formRef: RefObject<HTMLFormElement | null>, key: string): FormDraft {
  const [restored, setRestored] = useState(false);
  // El borrador se saca una sola vez por clave y se pone una sola vez: React corre los efectos dos veces en
  // desarrollo, y Next deja ocultas las pantallas anteriores y las vuelve a mostrar (los efectos corren de nuevo
  // con lo escrito después en el formulario, que un borrador ya recuperado no puede pisar).
  const taken = useRef<{ key: string; draft: DraftRecord | null } | null>(null);

  useEffect(() => {
    const form = formRef.current;
    const storage = getDraftStorage();
    if (!form || !storage) return;

    const saveOnSubmit = () => {
      // La página con la que el login va a comparar (la misma cuenta que hace el servidor con el `Referer`).
      const page = returnPath(`${window.location.pathname}${window.location.search}`);
      saveDraft(storage, key, readFormFields(form), Date.now(), page);
      // Ya se mandó: el aviso de «recuperamos lo que habías escrito» deja de hacer falta.
      setRestored(false);
    };
    form.addEventListener("submit", saveOnSubmit);

    if (taken.current?.key !== key) taken.current = { key, draft: takeRecoverableDraft(storage, key) };
    const draft = taken.current.draft;

    let timer: number | undefined;
    if (draft !== null) {
      let pass = 0;
      const restore = () => {
        pass += 1;
        const changed = writeFormFields(form, draft.fields);
        if (changed > 0 && pass < MAX_RESTORE_PASSES) {
          timer = window.setTimeout(restore, 0);
          return;
        }
        taken.current = { key, draft: null };
        setRestored(true);
      };
      timer = window.setTimeout(restore, 0);
    }

    return () => {
      form.removeEventListener("submit", saveOnSubmit);
      window.clearTimeout(timer);
    };
  }, [formRef, key]);

  const discard = useCallback(() => {
    const storage = getDraftStorage();
    if (storage) removeDraft(storage, key);
    setRestored(false);
  }, [key]);

  return { restored, discard };
}
