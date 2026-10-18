import { useSyncExternalStore } from "react";

// Un snapshot que siempre es `true` en el navegador y `false` al renderizar en
// el servidor: dice si la página ya está lista para usarse.
const subscribeNever = () => () => {};
const isHydrated = () => true;
const isNotHydrated = () => false;

/**
 * ¿Ya tomó React la página? Es `false` en el servidor y en la primera pasada del
 * navegador, y pasa a `true` al hidratar. Los formularios del panel lo usan
 * para no dejar enviar antes de tiempo: un clic anterior a la hidratación no
 * haría nada. Es solo para componentes de cliente.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, isHydrated, isNotHydrated);
}
