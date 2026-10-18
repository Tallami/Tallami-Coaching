/**
 * Cómo se ve una opción elegida entre varias tarjetas con casilla redonda (el
 * alumno de la venta, el tipo de cambio): fondo de escenario y texto claro. Como
 * el fondo pasa a ser oscuro, el aro de foco de la casilla pasa a dorado: en
 * azul contrastaría 2,8:1 y se pide al menos 3:1.
 */
export const CHOSEN_CHOICE_CLASSES =
  "has-[:checked]:bg-stage has-[:checked]:text-on-stage has-[:checked]:[&_input:focus-visible]:outline-gold";
