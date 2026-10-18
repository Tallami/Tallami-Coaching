import Link from "next/link";
import { STUDENTS_PARAMS, studentsQueryString } from "@/admin/customers/query";
import { MAX_SEARCH_LENGTH } from "@/admin/limits";
import { ADMIN_ROUTES } from "@/admin/routes";
import { Field } from "@/admin/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface StudentsSearchProps {
  /** El texto que se está buscando, si hay. */
  q: string | undefined;
}


/**
 * Buscador de la lista: un formulario `GET`, así que la búsqueda queda en la
 * dirección y se puede compartir. Es un solo campo: no hace falta esconderlo
 * detrás de un botón en el celular.
 */
export function StudentsSearch({ q }: StudentsSearchProps) {
  return (
    <form
      // El campo es "no controlado": al cambiar la búsqueda (volver, limpiar) se arma un formulario nuevo.
      key={studentsQueryString(q)}
      method="get"
      action={ADMIN_ROUTES.students}
      aria-label="Buscar alumnos"
      className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3 border-2 border-ink bg-white p-4"
    >
      <Field id="students-q" label="Buscar alumno" className="min-w-[14rem] flex-1">
        {(control) => (
          <Input
            {...control}
            type="search"
            name={STUDENTS_PARAMS.q}
            defaultValue={q ?? ""}
            maxLength={MAX_SEARCH_LENGTH}
            autoComplete="off"
            placeholder="Nombre o Discord"
          />
        )}
      </Field>
      <Button type="submit" size="sm">
        Buscar
      </Button>
      {q ? (
        <Link
          href={ADMIN_ROUTES.students}
          prefetch={false}
          className="inline-flex min-h-11 items-center rounded-[2px] font-bold underline underline-offset-4 hover:text-zone"
        >
          Limpiar búsqueda
        </Link>
      ) : null}
    </form>
  );
}
