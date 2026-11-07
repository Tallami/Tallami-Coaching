// La forma de una página legal (términos, reembolsos, privacidad). Cada archivo de esta carpeta
// exporta un `Record<Locale, LegalDocument>`: el mismo documento en los tres idiomas, con las
// mismas secciones en el mismo orden (lo cuida `tests/unit/legal-content.test.ts`).

/** Una sección: su título y sus párrafos, en texto plano. */
export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  /** El título de la página (y de la pestaña, con " · Tallami Coaching"). */
  title: string;
  /** Una oración: va debajo del título y en la descripción para los buscadores. */
  description: string;
  /** Cuándo cambió por última vez, `aaaa-mm-dd`. La página lo muestra en el idioma de cada uno. */
  updatedOn: string;
  sections: LegalSection[];
}
