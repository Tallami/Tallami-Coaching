interface MonogramProps {
  /** Lado en píxeles. */
  size?: number;
}

/** La "T" de Tallami sobre azul escenario con el cuadrado dorado (el ícono de la web). */
export function Monogram({ size = 44 }: MonogramProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect width="64" height="64" rx="11.52" fill="#0B1433" />
      <path fill="#F3F5FA" d="M13.5 11h34v12H36.5v30h-12V23h-11z" />
      <rect x="40.5" y="43" width="10" height="10" fill="#FFC93C" />
    </svg>
  );
}
