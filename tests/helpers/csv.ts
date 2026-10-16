// Lector de CSV para los tests de la exportación: separador `;`, comillas
// dobles con `""` como comilla escapada y saltos de línea dentro de comillas.
// Quita el BOM del principio. No valida: lee lo que escribe `salesToCsv`.

export function parseCsv(text: string, separator = ";"): string[][] {
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (body[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = false;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      endCell();
    } else if (char === "\r") {
      if (body[index + 1] === "\n") index += 1;
      endRow();
    } else if (char === "\n") {
      endRow();
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}
