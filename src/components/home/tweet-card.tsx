import { Fragment } from "react";
import Image from "next/image";
import { playerByHandle } from "@/content/players";
import { authorInitials, tweetTextParts, type TweetCard as TweetCardData } from "@/lib/tweets";
import styles from "./tweet-card.module.css";

const AVATAR_SIZE = 40;
/**
 * Ancho de la foto en pantalla: la tarjeta de 250 px menos relleno y borde.
 * Con este ancho (y no el de la foto original) `next/image` pide solo dos
 * archivos, para pantallas 1x y 2x, en vez de una lista de 15 tamaños.
 */
const PHOTO_WIDTH = 220;

/**
 * Los emojis del texto se muestran como imágenes de Twemoji (los mismos que
 * usa X), para que se vean igual en cualquier dispositivo: en Windows 10 los
 * emojis nuevos salen como cuadraditos y las banderas como letras ("AR").
 * La versión va fija a propósito: una URL con versión no cambia nunca, así
 * jsDelivr y el navegador la cachean sin límite y un dibujo nuevo no aparece
 * de golpe. Subirla es un cambio a mano, probando que cada emoji de los tweets
 * siga respondiendo 200 (probado con 17.0.3 el 13-oct-2026).
 */
const TWEMOJI_VERSION = "17.0.3";
const TWEMOJI_BASE_URL = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TWEMOJI_VERSION}/assets/svg`;

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
 * El círculo del autor: la foto local del jugador (`src/assets/players`, la misma
 * de la franja "Trabajé con") y, si el autor no tiene una, sus iniciales sobre
 * el círculo azul. Nunca el avatar de X: a veces responde 404 y la tarjeta
 * quedaría con una imagen rota. Es decoración: va dentro del bloque que se
 * oculta al lector de pantalla.
 */
function Avatar({ author }: { author: TweetCardData["author"] }) {
  const photo = playerByHandle(author.handle)?.photo;
  if (!photo) {
    return <span className={styles.initials}>{authorInitials(author.name, author.handle)}</span>;
  }
  return (
    <Image className={styles.avatar} src={photo} alt="" width={AVATAR_SIZE} height={AVATAR_SIZE} />
  );
}

/**
 * Un emoji como imagen de Twemoji. No usa `next/image`: son SVG chicos que ya
 * sirve un CDN, y el optimizador no los mejoraría. El `alt` es el emoji: es lo
 * que lee el lector de pantalla y lo que se ve si la imagen no carga.
 */
function Emoji({ value, code }: { value: string; code: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG de CDN: ver arriba.
    <img
      className={styles.emoji}
      src={`${TWEMOJI_BASE_URL}/${code}.svg`}
      alt={value}
      draggable={false}
      loading="lazy"
      decoding="async"
    />
  );
}

/**
 * Texto del tweet como texto de React (nunca como HTML). @tallami1 va en dorado
 * y negrita, las demás menciones en azul claro y los emojis son imágenes; los
 * saltos de línea se respetan por CSS (`white-space: pre-line`).
 */
function TweetText({ text }: { text: string }) {
  return (
    <span className={styles.text}>
      {tweetTextParts(text).map((part, index) => {
        switch (part.kind) {
          case "text":
            return <Fragment key={index}>{part.value}</Fragment>;
          case "emoji":
            return <Emoji key={index} value={part.value} code={part.code} />;
          default:
            return (
              <span key={index} className={styles[part.kind]}>
                {part.value}
              </span>
            );
        }
      })}
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
        <Avatar author={author} />
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
