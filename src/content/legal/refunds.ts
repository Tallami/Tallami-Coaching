// Reembolsos y arrepentimiento, en los tres idiomas. BORRADOR PARA EL ABOGADO: las reglas son las
// que aceptó Tallami (diseño de pagos, "Reglas aceptadas"). El abogado confirma, sobre todo, cuándo
// cuenta como usado cada servicio, la regla de los 15 minutos y el vencimiento de las compras.
//
// El vencimiento sale de `src/payments/policy.ts`; los 10 días, las 24 horas y los 15 minutos son
// reglas sin código y van escritos, como en las preguntas frecuentes.

import type { Locale } from "@/i18n/routing";
import { PURCHASE_EXPIRY_DAYS } from "@/payments/policy";
import type { LegalDocument } from "./types";

const UPDATED_ON = "2026-11-07";
const EXPIRY_DAYS = PURCHASE_EXPIRY_DAYS;

export const REFUNDS: Record<Locale, LegalDocument> = {
  es: {
    title: "Reembolsos y arrepentimiento",
    description: "Cuándo podés pedir que te devuelvan lo que pagaste, cómo se pide y cómo se devuelve.",
    updatedOn: UPDATED_ON,
    sections: [
      {
        heading: "Tus 10 días para arrepentirte",
        paragraphs: [
          "Tenés 10 días corridos desde la compra para arrepentirte y pedir que te devuelvan todo lo que pagaste, salvo que el servicio ya se haya entregado. No hace falta que expliques por qué.",
          "La misma regla vale desde cualquier país, y es un derecho que no se puede renunciar.",
        ],
      },
      {
        heading: "Cómo pedirlo",
        paragraphs: [
          "Usá el BOTÓN DE ARREPENTIMIENTO, al pie de cada página. No hace falta entrar con tu cuenta: completás tu nombre, tu email y, si lo tenés, el número de tu compra.",
          "Al mandarlo ves en pantalla un código de tu pedido, que también te llega por email. Guardalo: con ese código Tallami encuentra tu pedido.",
          "Para dar de baja un servicio en curso, como la Temporada Pro, usá el BOTÓN DE BAJA DE SERVICIO, que funciona igual.",
        ],
      },
      {
        heading: "Cuándo cuenta como entregado",
        paragraphs: [
          "VOD review de 3 partidas y VOD review de torneo completo: cuando el video con el análisis está en tu portal.",
          "Plan de juego personalizado: cuando el plan está en tu portal.",
          "VOD review en vivo: cuando empieza la sesión.",
          "Temporada Pro: lo fija el acuerdo de cada equipo.",
          "Mientras el servicio no se entregó, dentro de los 10 días el reembolso es completo.",
        ],
      },
      {
        heading: "Sesiones en vivo: cambios y ausencias",
        paragraphs: [
          "Una sesión en vivo se puede cambiar sin costo si avisás con al menos 24 horas.",
          "Si no avisás y pasan 15 minutos del inicio sin que te conectes, la sesión cuenta como usada.",
          "Si el que falta es Tallami, elegís otra fecha o el reembolso completo.",
        ],
      },
      {
        heading: "Compras sin usar",
        paragraphs: [
          `Una compra vence a los ${EXPIRY_DAYS} días desde el pago si en ese tiempo no se usó: por ejemplo, si no mandaste los códigos de replay o no se hizo la sesión.`,
          "Si ves que no llegás a usarla, escribile a Tallami antes desde el formulario de contacto.",
        ],
      },
      {
        heading: "Cómo se devuelve el dinero",
        paragraphs: [
          "Tallami te devuelve por Mercado Pago lo que pagaste, en pesos.",
          "Cuándo lo ves acreditado depende de Mercado Pago y del medio de pago que usaste.",
        ],
      },
    ],
  },
  pt: {
    title: "Reembolsos e arrependimento",
    description: "Quando você pode pedir a devolução do que pagou, como pedir e como o dinheiro é devolvido.",
    updatedOn: UPDATED_ON,
    sections: [
      {
        heading: "Seus 10 dias para se arrepender",
        paragraphs: [
          "Você tem 10 dias corridos a partir da compra para se arrepender e pedir a devolução de tudo o que pagou, a menos que o serviço já tenha sido entregue. Não precisa explicar o motivo.",
          "A mesma regra vale de qualquer país, e é um direito que não pode ser renunciado.",
        ],
      },
      {
        heading: "Como pedir",
        paragraphs: [
          "Use o BOTÓN DE ARREPENTIMIENTO, no rodapé de cada página. Não precisa entrar com a sua conta: você preenche o seu nome, o seu e-mail e, se tiver, o número da sua compra.",
          "Ao enviar, você vê na tela um código do seu pedido, que também chega por e-mail. Guarde-o: com esse código o Tallami encontra o seu pedido.",
          "Para cancelar um serviço em andamento, como a Temporada Pro, use o BOTÓN DE BAJA DE SERVICIO, que funciona do mesmo jeito.",
        ],
      },
      {
        heading: "Quando conta como entregue",
        paragraphs: [
          "VOD review de 3 partidas e VOD review de torneio completo: quando o vídeo com a análise está no seu portal.",
          "Plano de jogo personalizado: quando o plano está no seu portal.",
          "VOD review ao vivo: quando a sessão começa.",
          "Temporada Pro: definido no acordo de cada equipe.",
          "Enquanto o serviço não foi entregue, dentro dos 10 dias o reembolso é integral.",
        ],
      },
      {
        heading: "Sessões ao vivo: remarcação e ausências",
        paragraphs: [
          "Uma sessão ao vivo pode ser remarcada sem custo se você avisar com pelo menos 24 horas de antecedência.",
          "Se você não avisar e passarem 15 minutos do início sem que você se conecte, a sessão conta como usada.",
          "Se quem faltar for o Tallami, você escolhe outra data ou o reembolso integral.",
        ],
      },
      {
        heading: "Compras não usadas",
        paragraphs: [
          `Uma compra vence ${EXPIRY_DAYS} dias após o pagamento se nesse tempo não for usada: por exemplo, se você não enviou os códigos de replay ou a sessão não aconteceu.`,
          "Se perceber que não vai conseguir usá-la, escreva antes para o Tallami pelo formulário de contato.",
        ],
      },
      {
        heading: "Como o dinheiro é devolvido",
        paragraphs: [
          "O Tallami devolve pelo Mercado Pago o que você pagou, em pesos.",
          "Quando o valor aparece depende do Mercado Pago e do meio de pagamento que você usou.",
        ],
      },
    ],
  },
  en: {
    title: "Refunds and withdrawal",
    description: "When you can ask for your money back, how to ask and how it's returned.",
    updatedOn: UPDATED_ON,
    sections: [
      {
        heading: "Your 10 days to change your mind",
        paragraphs: [
          "You have 10 calendar days from the purchase to change your mind and get back everything you paid, unless the service has already been delivered. You don't need to say why.",
          "The same rule applies from any country, and it's a right that can't be waived.",
        ],
      },
      {
        heading: "How to ask",
        paragraphs: [
          "Use the BOTÓN DE ARREPENTIMIENTO (withdrawal button) at the bottom of every page. You don't need to sign in: you fill in your name, your email and, if you have it, your purchase number.",
          "When you send it, you see a code for your request on screen, and it also arrives by email. Keep it: with that code Tallami finds your request.",
          "To cancel a service in progress, such as Temporada Pro, use the BOTÓN DE BAJA DE SERVICIO (cancellation button), which works the same way.",
        ],
      },
      {
        heading: "When it counts as delivered",
        paragraphs: [
          "3-game VOD review and full tournament VOD review: when the analysis video is in your portal.",
          "Custom game plan: when the plan is in your portal.",
          "Live VOD review: when the session starts.",
          "Temporada Pro: set in each team's agreement.",
          "As long as the service hasn't been delivered, within the 10 days the refund is full.",
        ],
      },
      {
        heading: "Live sessions: rescheduling and no-shows",
        paragraphs: [
          "A live session can be moved at no cost if you give at least 24 hours' notice.",
          "If you don't give notice and 15 minutes pass from the start without you joining, the session counts as used.",
          "If Tallami is the one who misses it, you choose another date or a full refund.",
        ],
      },
      {
        heading: "Unused purchases",
        paragraphs: [
          `A purchase expires ${EXPIRY_DAYS} days after payment if it isn't used in that time: for example, if you didn't send the replay codes or the session didn't happen.`,
          "If you see you won't get to use it, write to Tallami beforehand through the contact form.",
        ],
      },
      {
        heading: "How the money is returned",
        paragraphs: [
          "Tallami refunds what you paid, in pesos, through Mercado Pago.",
          "When you see it credited depends on Mercado Pago and the payment method you used.",
        ],
      },
    ],
  },
};
