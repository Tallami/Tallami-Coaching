import { Faq } from "@/components/home/faq";
import { Hero } from "@/components/home/hero";
import { HowItWorks } from "@/components/home/how-it-works";
import { PlayersStrip } from "@/components/home/players-strip";
import { ResultsBoard } from "@/components/home/results-board";
import { ReviewsWall } from "@/components/home/reviews-wall";
import { ServicesMenu } from "@/components/home/services-menu";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { TWEET_IDS } from "@/content/tweets";
import { getTweetCards } from "@/lib/tweets";

export default async function HomePage() {
  // Una sola lectura (cacheada) para el muro y para el link de la navegación:
  // sin tarjetas no hay sección ni link.
  const tweets = await getTweetCards(TWEET_IDS);

  return (
    <>
      <SiteHeader hasReviews={tweets.length > 0} />
      <main id="contenido">
        <Hero />
        <PlayersStrip />
        <ResultsBoard />
        <ReviewsWall cards={tweets} />
        <ServicesMenu />
        <HowItWorks />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
