/** La fecha de `months` meses antes de `now` (en UTC). Para los plazos de borrado. */
export function monthsBefore(now: Date, months: number): Date {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}
