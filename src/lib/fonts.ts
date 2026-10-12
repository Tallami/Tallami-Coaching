import { Saira } from "next/font/google";

/** Tipografía única del sitio. La usan el layout de idioma y el 404 global. */
export const saira = Saira({
  axes: ["wdth"],
  subsets: ["latin"],
  variable: "--font-saira",
  display: "swap",
});
