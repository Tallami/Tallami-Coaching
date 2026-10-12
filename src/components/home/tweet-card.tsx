import { Fragment } from "react";
import Image from "next/image";
import { tweetTextParts, type TweetCard as TweetCardData } from "@/lib/tweets";
import styles from "./tweet-card.module.css";

const AVATAR_SIZE = 40;
/**
 * Ancho de la foto en pantalla: la tarjeta de 250 px menos relleno y borde.
 * Con este ancho (y no el de la foto original) `next/image` pide solo dos
 * archivos, para pantallas 1x y 2x, en vez de una lista de 15 tamaños.
 */
const PHOTO_WIDTH = 220;

export interface TweetCardProps {
  card: TweetCardData;
  /** Nombre del link para el lector de pantalla ("Tweet de Lewa en X"). */
  label: string;
  /** Fecha ya formateada en el idioma de la página. */
  date: string;
  /** "Ver en X". */
  viewOnX: string;
}

/**
 * Texto del tweet como texto de React (nunca como HTML). @tallami1 va en dorado
 * y negrita, las demás menciones en azul claro; los saltos de línea se respetan
 * por CSS (`white-space: pre-line`).
 */
function TweetText({ text }: { text: string }) {
  return (
    <span className={styles.text}>
      {tweetTextParts(text).map((part, index) =>
        part.kind === "text" ? (
          <Fragment key={index}>{part.value}</Fragment>
        ) : (
          <span key={index} className={styles[part.kind]}>
            {part.value}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * Tarjeta de un tweet del muro de Reviews: toda ella es un link al tweet en X,
 * que abre en otra pestaña. Es un Server Component que se muestra dos veces por
 * fila (la copia del loop la arma `MarqueeRow`), por eso no lleva `id`.
 *
 * El nombre del link empieza con `label` y sigue con el texto del tweet y la
 * fecha, así el lector de pantalla también lee el tweet. El encabezado con el
 * autor y la marca de X se ocultan al lector: `label` ya dice quién es.
 * Un tweet sin texto (solo foto) no deja hueco: el bloque de texto no se arma.
 */
export function TweetCard({ card, label, date, viewOnX }: TweetCardProps) {
  const { author, image, text } = card;

  return (
    <a
      className={styles.card}
      href={card.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="sr-only">{label}: </span>
      <span className={styles.head} aria-hidden="true">
        <Image
          className={styles.avatar}
          src={author.avatarUrl}
          alt=""
          width={AVATAR_SIZE}
          height={AVATAR_SIZE}
        />
        <span className={styles.who}>
          <b>{author.name}</b>
          <span>@{author.handle}</span>
        </span>
        <span className={styles.mark}>𝕏</span>
      </span>
      {text && <TweetText text={text} />}
      {image && (
        <Image
          className={styles.photo}
          src={image.url}
          alt=""
          width={PHOTO_WIDTH}
          height={Math.round((PHOTO_WIDTH * image.height) / image.width)}
          loading="lazy"
        />
      )}
      <span className={styles.foot}>
        <time dateTime={card.createdAt}>{date}</time>
        <span className={styles.go}>
          {viewOnX} <span aria-hidden="true">→</span>
        </span>
      </span>
    </a>
  );
}
