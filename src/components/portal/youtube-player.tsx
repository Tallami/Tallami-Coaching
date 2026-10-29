import { youtubeEmbedUrl } from "@/portal/youtube";

interface YoutubePlayerProps {
  videoId: string;
  /** El título de la entrega: es el nombre accesible del marco. */
  title: string;
}

/**
 * Un video de YouTube embebido con `youtube-nocookie.com`: sin cookies de YouTube hasta que el alumno
 * toca "play". 16:9 y de ancho flexible. Se carga recién cuando se acerca a la pantalla (`lazy`).
 *
 * `referrerPolicy` es lo que YouTube exige a sus reproductores embebidos: sin un encabezado
 * `Referer` el video responde con un error. La página manda `no-referrer`, así que el marco lleva
 * su propia política, que pisa la de la página solo para este pedido.
 */
export function YoutubePlayer({ videoId, title }: YoutubePlayerProps) {
  return (
    <div className="stage aspect-video w-full max-w-3xl overflow-hidden rounded-[4px]">
      <iframe
        src={youtubeEmbedUrl(videoId)}
        title={title}
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className="size-full border-0"
      />
    </div>
  );
}
