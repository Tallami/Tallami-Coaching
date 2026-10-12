import { Hero } from "@/components/home/hero";
import { ResultsBoard } from "@/components/home/results-board";
import { SiteHeader } from "@/components/home/site-header";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="contenido">
        <Hero />
        <ResultsBoard />
      </main>
    </>
  );
}
