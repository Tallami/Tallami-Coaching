import { Faq } from "@/components/home/faq";
import { Hero } from "@/components/home/hero";
import { HowItWorks } from "@/components/home/how-it-works";
import { ResultsBoard } from "@/components/home/results-board";
import { ServicesMenu } from "@/components/home/services-menu";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="contenido">
        <Hero />
        <ResultsBoard />
        <ServicesMenu />
        <HowItWorks />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
