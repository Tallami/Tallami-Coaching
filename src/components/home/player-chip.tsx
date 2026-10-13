import Image from "next/image";
import type { Player } from "@/content/players";
import styles from "./players-strip.module.css";

const PHOTO_SIZE = 34;

/** Foto redonda y nombre. Sin foto, la inicial sobre un círculo azul. */
export function PlayerChip({ player }: { player: Player }) {
  return (
    <li className={styles.player}>
      {player.photo ? (
        <Image
          src={player.photo}
          alt=""
          width={PHOTO_SIZE}
          height={PHOTO_SIZE}
          className={styles.photo}
        />
      ) : (
        <span className={styles.initial} aria-hidden="true">
          {player.name.charAt(0)}
        </span>
      )}
      {player.name}
    </li>
  );
}
