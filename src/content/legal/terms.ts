// Términos y condiciones, en los tres idiomas. BORRADOR PARA EL ABOGADO: sale del esquema de
// catorce cláusulas del diseño de pagos (docs/superpowers/specs/2026-11-03-payments-mercadopago-design.md)
// y de las reglas que aceptó Tallami. Antes de cobrar de verdad lo revisa un abogado.
//
// Los números que el código hace cumplir (plazos de entrega, vencimiento de compras y de links)
// salen de `src/payments/policy.ts`; los que son reglas de Tallami sin código (los 10 días, los
// 13 años, las 24 horas, los 15 minutos) van escritos, como en las preguntas frecuentes.

import { PRO_SEASON } from "@/content/services";
import type { Locale } from "@/i18n/routing";
import { formatUsd } from "@/lib/format";
import { PRO_LINK_TTL_MS, PURCHASE_EXPIRY_DAYS, REPLAY_DELIVERY_HOURS } from "@/payments/policy";
import type { LegalDocument } from "./types";

const UPDATED_ON = "2026-11-12";
const DAY_MS = 24 * 60 * 60 * 1000;

const VOD_HOURS = REPLAY_DELIVERY_HOURS.vodRecorded;
const TOURNAMENT_HOURS = REPLAY_DELIVERY_HOURS.tournamentReview;
const EXPIRY_DAYS = PURCHASE_EXPIRY_DAYS;
const PRO_LINK_DAYS = PRO_LINK_TTL_MS / DAY_MS;

export const TERMS: Record<Locale, LegalDocument> = {
  es: {
    title: "Términos y condiciones",
    description: "Las reglas para comprar y usar los servicios de coaching de Tallami.",
    updatedOn: UPDATED_ON,
    sections: [
      {
        heading: "Quién vende",
        paragraphs: [
          "Los servicios de esta web los vende y los presta Tomás Allami, conocido como «Tallami», coach de Fortnite competitivo en Argentina. En estos términos, «Tallami» es él y «vos» es quien compra o usa un servicio.",
          "Para cualquier consulta, escribile desde el formulario de contacto de esta web. El horario de atención es de lunes a viernes, de 10 a 18, hora de Argentina.",
        ],
      },
      {
        heading: "Qué se vende",
        paragraphs: [
          `VOD review de 3 partidas: le pasás a Tallami los códigos de replay de 3 partidas y te devuelve un análisis en video dentro de las ${VOD_HOURS} horas desde que llegan los códigos.`,
          `VOD review de torneo completo: le pasás los códigos de replay de todo el torneo y te devuelve un análisis completo en video dentro de las ${TOURNAMENT_HOURS} horas desde que llegan los códigos.`,
          "VOD review en vivo: una sesión de 60 minutos en la que miran juntos tu partida y Tallami te corrige en el momento. El día y la hora se coordinan después de la compra.",
          "Plan de juego personalizado: un plan armado para tu forma de jugar y tus próximos torneos. Tallami te lo entrega en tu portal, y el plazo se coordina con vos después de la compra.",
          "Temporada Pro: coaching para tu dúo o trío durante toda la temporada. Se entra por aplicación (ver «Temporada Pro», más abajo).",
          `Cada compra se usa dentro de los ${EXPIRY_DAYS} días desde el pago: si en ese plazo no mandaste los códigos ni se hizo la sesión, la compra vence. Si ves que no llegás, escribile a Tallami antes.`,
          "El precio y la descripción de cada servicio son los que muestra la web en el momento de la compra.",
        ],
      },
      {
        heading: "Quién puede comprar",
        paragraphs: [
          "El pago lo hace siempre una persona mayor de edad: el propio jugador, si tiene 18 años o más, o un adulto responsable del jugador. Antes de pagar, quien paga lo confirma con una casilla.",
          "Pueden entrenar jugadores desde los 13 años. Si el jugador tiene menos de 18, entrena con la aprobación del adulto responsable que hizo el pago.",
        ],
      },
      {
        heading: "Cuentas",
        paragraphs: [
          "Para comprar y para ver lo que te entrega Tallami, entrás al Portal de alumnos con tu cuenta de Discord o de Google. La web no te pide una contraseña propia.",
          "Cada alumno usa una sola cuenta, y lo que compraste aparece en esa cuenta. Cuidá el acceso a tu Discord o a tu Google: quien entra con ellos ve tu portal.",
        ],
      },
      {
        heading: "Precio y pago",
        paragraphs: [
          "El precio de referencia de cada servicio está en dólares estadounidenses. En Argentina se cobra en pesos, según el valor del dólar que fija Tallami, y ves el monto exacto en pesos antes de confirmar.",
          "Se paga con Mercado Pago, en una cuota. Si no completás el pago dentro de la hora, vence, y podés empezar de nuevo con el precio de ese momento.",
          "La compra queda pagada cuando Mercado Pago confirma el pago. Los datos de tu tarjeta o de tu cuenta los ve solo Mercado Pago: esta web nunca los recibe.",
          "Por ahora la web cobra solo con Mercado Pago, desde Argentina. Si estás en otro país, escribile a Tallami desde el formulario de contacto.",
        ],
      },
      {
        heading: "Entrega",
        paragraphs: [
          `En los VOD review de 3 partidas y de torneo completo, pegás los códigos de replay en tu compra, dentro del portal. El plazo de ${VOD_HOURS} o ${TOURNAMENT_HOURS} horas corre desde que llegan los códigos.`,
          "Tallami entrega en tu portal: un video no listado de YouTube, un PDF o un link, según el servicio. Lo que te entrega queda guardado ahí.",
          "Las sesiones en vivo y todo lo que haga falta se coordinan por el chat del portal. Para hablar en vivo, Tallami te pasa su Discord por ahí.",
        ],
      },
      {
        heading: "Uso de lo entregado",
        paragraphs: [
          "Lo que te entrega Tallami es para tu uso personal. No lo compartas, no lo publiques ni lo revendas, y tampoco sus links.",
          "Un video no listado de YouTube lo puede ver cualquiera que tenga el link: por eso, no se lo pases a nadie.",
        ],
      },
      {
        heading: "Arrepentimiento y reembolsos",
        paragraphs: [
          "Tenés 10 días corridos desde la compra para arrepentirte y pedir el reembolso completo, salvo que el servicio ya se haya entregado. Este derecho no se puede renunciar.",
          "Para pedirlo, usá el BOTÓN DE ARREPENTIMIENTO, al pie de cada página. Para dar de baja un servicio en curso, usá el BOTÓN DE BAJA DE SERVICIO. En los dos casos recibís un código de tu pedido.",
          "Cuándo cuenta como entregado cada servicio y cómo se devuelve el dinero lo explica la página Reembolsos, que es parte de estos términos. Tiene un enlace al pie de cada página.",
        ],
      },
      {
        heading: "Reprogramación y ausencias",
        paragraphs: [
          "Una sesión en vivo se puede cambiar sin costo si avisás con al menos 24 horas.",
          "Si no avisás y pasan 15 minutos del inicio sin que te conectes, la sesión cuenta como usada.",
          "Si el que falta es Tallami, elegís otra fecha o el reembolso completo.",
        ],
      },
      {
        heading: "Sin garantía de resultados",
        paragraphs: [
          "El coaching es análisis y un plan de trabajo. Tallami no promete un puesto, una clasificación ni premios: el resultado depende de tu juego y de cada torneo.",
          "Los resultados que muestra esta web son de los jugadores con los que trabajó Tallami, que autorizaron mostrarlos. No anticipan los tuyos.",
        ],
      },
      {
        heading: "Reglas del juego",
        paragraphs: [
          "Te comprometés a respetar las reglas de Epic Games y las de cada torneo. Tallami no trabaja con trampas, programas no permitidos ni cuentas compartidas o ajenas.",
          "Si un alumno no cumple estas reglas, Tallami puede terminar el servicio y devolver la parte que no se usó.",
          "Tallami Coaching es un servicio independiente. No afiliado ni respaldado por Epic Games. Fortnite es una marca de Epic Games.",
        ],
      },
      {
        heading: "Temporada Pro",
        paragraphs: [
          "A la Temporada Pro se entra por aplicación: el equipo manda un formulario corto y Tallami le escribe. Aplicar no garantiza un lugar.",
          `El precio de lista es ${formatUsd(PRO_SEASON.priceUsd, "es")} por equipo para toda la temporada. Si el equipo y Tallami acuerdan trabajar juntos, ese acuerdo fija qué incluye, el monto, si se paga en partes y cuándo corresponde un reembolso, siempre dentro de lo que permite la ley.`,
          `Cada pago se hace con un link personal que manda Tallami. El link sirve una sola vez y vence a los ${PRO_LINK_DAYS} días.`,
        ],
      },
      {
        heading: "Responsabilidad y cambios",
        paragraphs: [
          "Tallami responde por prestar cada servicio como lo describen estos términos. Su responsabilidad tiene los límites que permite la ley de defensa del consumidor, y nada de lo que dicen estos términos limita los derechos que esa ley te da.",
          "Estos términos pueden cambiar. La fecha de arriba dice cuándo cambiaron por última vez. Cada compra se rige por la versión vigente el día en que la hiciste: una versión nueva vale para las compras siguientes.",
        ],
      },
      {
        heading: "Ley y reclamos",
        paragraphs: [
          "Estos términos se rigen por la ley argentina, sin quitarte los derechos que te dan las normas de defensa del consumidor del lugar donde vivís.",
          "Si tenés un problema, escribile primero a Tallami desde el formulario de contacto, de lunes a viernes, de 10 a 18, hora de Argentina.",
          "Si no se resuelve, en Argentina podés reclamar ante la Ventanilla Federal Única de Reclamos de Defensa del Consumidor.",
        ],
      },
    ],
  },
  pt: {
    title: "Termos e condições",
    description: "As regras para comprar e usar os serviços de coaching do Tallami.",
    updatedOn: UPDATED_ON,
    sections: [
      {
        heading: "Quem vende",
        paragraphs: [
          "Os serviços deste site são vendidos e prestados por Tomás Allami, conhecido como “Tallami”, coach de Fortnite competitivo na Argentina. Nestes termos, “Tallami” é ele e “você” é quem compra ou usa um serviço.",
          "Para qualquer dúvida, escreva para ele pelo formulário de contato deste site. O horário de atendimento é de segunda a sexta, das 10h às 18h, horário da Argentina.",
        ],
      },
      {
        heading: "O que é vendido",
        paragraphs: [
          `VOD review de 3 partidas: você passa ao Tallami os códigos de replay de 3 partidas e ele devolve uma análise em vídeo em até ${VOD_HOURS} horas a partir da chegada dos códigos.`,
          `VOD review de torneio completo: você passa os códigos de replay do torneio inteiro e ele devolve uma análise completa em vídeo em até ${TOURNAMENT_HOURS} horas a partir da chegada dos códigos.`,
          "VOD review ao vivo: uma sessão de 60 minutos em que vocês assistem juntos à sua partida e o Tallami corrige você na hora. O dia e o horário são combinados depois da compra.",
          "Plano de jogo personalizado: um plano montado para o seu jeito de jogar e para os seus próximos torneios. O Tallami entrega no seu portal, e o prazo é combinado com você depois da compra.",
          "Temporada Pro: coaching para a sua dupla ou trio durante toda a temporada. A entrada é por candidatura (veja “Temporada Pro”, mais abaixo).",
          `Cada compra deve ser usada em até ${EXPIRY_DAYS} dias a partir do pagamento: se nesse prazo você não enviou os códigos nem a sessão aconteceu, a compra vence. Se perceber que não vai conseguir, escreva antes para o Tallami.`,
          "O preço e a descrição de cada serviço são os que o site mostra no momento da compra.",
        ],
      },
      {
        heading: "Quem pode comprar",
        paragraphs: [
          "O pagamento é sempre feito por uma pessoa maior de idade: o próprio jogador, se tiver 18 anos ou mais, ou um adulto responsável pelo jogador. Antes de pagar, quem paga confirma isso em uma caixa de seleção.",
          "Podem treinar jogadores a partir de 13 anos. Se o jogador tiver menos de 18, treina com a aprovação do adulto responsável que fez o pagamento.",
        ],
      },
      {
        heading: "Contas",
        paragraphs: [
          "Para comprar e para ver o que o Tallami entrega, você entra no Portal do aluno com a sua conta do Discord ou do Google. O site não pede uma senha própria.",
          "Cada aluno usa uma única conta, e o que você comprou aparece nela. Cuide do acesso ao seu Discord ou ao seu Google: quem entra com eles vê o seu portal.",
        ],
      },
      {
        heading: "Preço e pagamento",
        paragraphs: [
          "O preço de referência de cada serviço é em dólares americanos. Na Argentina, a cobrança é em pesos, conforme o valor do dólar definido pelo Tallami, e você vê o valor exato em pesos antes de confirmar.",
          "O pagamento é feito com Mercado Pago, em uma parcela. Se você não concluir o pagamento em uma hora, ele vence, e você pode começar de novo com o preço daquele momento.",
          "A compra fica paga quando o Mercado Pago confirma o pagamento. Os dados do seu cartão ou da sua conta só o Mercado Pago vê: este site nunca os recebe.",
          "Por enquanto o site só cobra com Mercado Pago, da Argentina. Se você está em outro país, escreva para o Tallami pelo formulário de contato.",
        ],
      },
      {
        heading: "Entrega dos serviços",
        paragraphs: [
          `Nos VOD reviews de 3 partidas e de torneio completo, você cola os códigos de replay na sua compra, dentro do portal. O prazo de ${VOD_HOURS} ou ${TOURNAMENT_HOURS} horas conta a partir da chegada dos códigos.`,
          "O Tallami entrega no seu portal: um vídeo não listado do YouTube, um PDF ou um link, conforme o serviço. O que ele entrega fica guardado lá.",
          "As sessões ao vivo e tudo o que for preciso são combinados pelo chat do portal. Para falar ao vivo, o Tallami passa o Discord dele por lá.",
        ],
      },
      {
        heading: "Uso do que é entregue",
        paragraphs: [
          "O que o Tallami entrega é para o seu uso pessoal. Não compartilhe, não publique nem revenda, nem os links.",
          "Um vídeo não listado do YouTube pode ser visto por qualquer pessoa que tenha o link: por isso, não passe o link para ninguém.",
        ],
      },
      {
        heading: "Arrependimento e reembolsos",
        paragraphs: [
          "Você tem 10 dias corridos a partir da compra para se arrepender e pedir o reembolso integral, a menos que o serviço já tenha sido entregue. Esse direito não pode ser renunciado.",
          "Para pedir, use o BOTÓN DE ARREPENTIMIENTO, no rodapé de cada página. Para cancelar um serviço em andamento, use o BOTÓN DE BAJA DE SERVICIO. Nos dois casos você recebe um código do seu pedido.",
          "Quando cada serviço conta como entregue e como o dinheiro é devolvido está na página Reembolsos, que faz parte destes termos. O link está no rodapé de cada página.",
        ],
      },
      {
        heading: "Remarcação e ausências",
        paragraphs: [
          "Uma sessão ao vivo pode ser remarcada sem custo se você avisar com pelo menos 24 horas de antecedência.",
          "Se você não avisar e passarem 15 minutos do início sem que você se conecte, a sessão conta como usada.",
          "Se quem faltar for o Tallami, você escolhe outra data ou o reembolso integral.",
        ],
      },
      {
        heading: "Sem garantia de resultados",
        paragraphs: [
          "O coaching é análise e um plano de trabalho. O Tallami não promete colocação, classificação nem prêmios: o resultado depende do seu jogo e de cada torneio.",
          "Os resultados que este site mostra são dos jogadores com quem o Tallami trabalhou, que autorizaram mostrá-los. Eles não antecipam os seus.",
        ],
      },
      {
        heading: "Regras do jogo",
        paragraphs: [
          "Você se compromete a respeitar as regras da Epic Games e as de cada torneio. O Tallami não trabalha com trapaças, programas não permitidos nem contas compartilhadas ou de terceiros.",
          "Se um aluno não cumprir essas regras, o Tallami pode encerrar o serviço e devolver a parte que não foi usada.",
          "O Tallami Coaching é um serviço independente. Não afiliado nem endossado pela Epic Games. Fortnite é uma marca da Epic Games.",
        ],
      },
      {
        heading: "Temporada Pro",
        paragraphs: [
          "Na Temporada Pro se entra por candidatura: a equipe envia um formulário curto e o Tallami escreve para ela. Enviar uma candidatura não garante uma vaga.",
          `O preço de tabela é ${formatUsd(PRO_SEASON.priceUsd, "pt")} por equipe para toda a temporada. Se a equipe e o Tallami combinarem trabalhar juntos, esse acordo define o que inclui, o valor, se o pagamento é em partes e quando cabe um reembolso, sempre dentro do que a lei permite.`,
          `Cada pagamento é feito com um link pessoal que o Tallami envia. O link serve uma única vez e vence em ${PRO_LINK_DAYS} dias.`,
        ],
      },
      {
        heading: "Responsabilidade e mudanças",
        paragraphs: [
          "O Tallami responde por prestar cada serviço como estes termos o descrevem. A responsabilidade dele tem os limites que a lei de defesa do consumidor permite, e nada destes termos limita os direitos que essa lei dá a você.",
          "Estes termos podem mudar. A data no topo indica quando mudaram pela última vez. Cada compra segue a versão vigente no dia em que você a fez: uma versão nova vale para as compras seguintes.",
        ],
      },
      {
        heading: "Lei e reclamações",
        paragraphs: [
          "Estes termos seguem a lei argentina, sem tirar de você os direitos que as normas de defesa do consumidor do lugar onde você mora lhe dão.",
          "Se tiver um problema, escreva primeiro para o Tallami pelo formulário de contato, de segunda a sexta, das 10h às 18h, horário da Argentina.",
          "Se não se resolver, na Argentina você pode reclamar na Ventanilla Federal Única de Reclamos de Defensa del Consumidor, o canal oficial de reclamações do consumidor.",
        ],
      },
    ],
  },
  en: {
    title: "Terms and conditions",
    description: "The rules for buying and using Tallami's coaching services.",
    updatedOn: UPDATED_ON,
    sections: [
      {
        heading: "Who sells",
        paragraphs: [
          "The services on this site are sold and provided by Tomás Allami, known as “Tallami”, a competitive Fortnite coach in Argentina. In these terms, “Tallami” means him and “you” means whoever buys or uses a service.",
          "For any question, write to him through this site's contact form. Support hours are Monday to Friday, 10 am to 6 pm, Argentina time.",
        ],
      },
      {
        heading: "What is sold",
        paragraphs: [
          `3-game VOD review: you send Tallami the replay codes for 3 games and he sends back a video analysis within ${VOD_HOURS} hours of the codes arriving.`,
          `Full tournament VOD review: you send the replay codes for the whole tournament and he sends back a full video analysis within ${TOURNAMENT_HOURS} hours of the codes arriving.`,
          "Live VOD review: a 60-minute session where you watch your game together and Tallami corrects you in the moment. The day and time are set after the purchase.",
          "Custom game plan: a plan built around how you play and your upcoming tournaments. Tallami delivers it in your portal, on a timeline agreed with you after the purchase.",
          "Temporada Pro: coaching for your duo or trio for the whole season. Entry is by application (see “Temporada Pro” below).",
          `Each purchase must be used within ${EXPIRY_DAYS} days of payment: if in that time you haven't sent the codes or the session hasn't happened, the purchase expires. If you see you won't make it, write to Tallami beforehand.`,
          "The price and description of each service are the ones the site shows at the time of purchase.",
        ],
      },
      {
        heading: "Who can buy",
        paragraphs: [
          "Payment is always made by an adult: the player, if 18 or older, or an adult responsible for the player. Before paying, whoever pays confirms this with a checkbox.",
          "Players can train from age 13. If the player is under 18, they train with the approval of the responsible adult who made the payment.",
        ],
      },
      {
        heading: "Accounts",
        paragraphs: [
          "To buy and to see what Tallami delivers, you sign in to the Student portal with your Discord or Google account. The site doesn't ask you for a password of its own.",
          "Each student uses a single account, and what you bought shows up in it. Keep your Discord or Google account safe: whoever signs in with it sees your portal.",
        ],
      },
      {
        heading: "Price and payment",
        paragraphs: [
          "Each service's reference price is in US dollars. In Argentina you're charged in pesos, at the dollar rate Tallami sets, and you see the exact amount in pesos before you confirm.",
          "Payment is through Mercado Pago, in a single installment. If you don't finish paying within an hour, the payment expires, and you can start again at that moment's price.",
          "The purchase is paid once Mercado Pago confirms the payment. Only Mercado Pago sees your card or account details: this site never receives them.",
          "For now the site only takes payments through Mercado Pago, from Argentina. If you're in another country, write to Tallami through the contact form.",
        ],
      },
      {
        heading: "Delivery",
        paragraphs: [
          `For the 3-game and full tournament VOD reviews, you paste the replay codes into your purchase, inside the portal. The ${VOD_HOURS} or ${TOURNAMENT_HOURS} hours start when the codes arrive.`,
          "Tallami delivers in your portal: an unlisted YouTube video, a PDF or a link, depending on the service. What he delivers stays saved there.",
          "Live sessions and anything else that's needed are arranged in the portal chat. To talk live, Tallami gives you his Discord there.",
        ],
      },
      {
        heading: "Use of what is delivered",
        paragraphs: [
          "What Tallami delivers is for your personal use. Don't share, publish or resell it, or its links.",
          "Anyone with the link can watch an unlisted YouTube video, so don't pass the link on to anyone.",
        ],
      },
      {
        heading: "Withdrawal and refunds",
        paragraphs: [
          "You have 10 calendar days from the purchase to change your mind and ask for a full refund, unless the service has already been delivered. This right cannot be waived.",
          "To ask for it, use the BOTÓN DE ARREPENTIMIENTO (withdrawal button) at the bottom of every page. To cancel a service in progress, use the BOTÓN DE BAJA DE SERVICIO (cancellation button). Either way you get a code for your request.",
          "When each service counts as delivered and how the money is returned are explained on the Refunds page, which is part of these terms. It's linked at the bottom of every page.",
        ],
      },
      {
        heading: "Rescheduling and no-shows",
        paragraphs: [
          "A live session can be moved at no cost if you give at least 24 hours' notice.",
          "If you don't give notice and 15 minutes pass from the start without you joining, the session counts as used.",
          "If Tallami is the one who misses it, you choose another date or a full refund.",
        ],
      },
      {
        heading: "No guarantee of results",
        paragraphs: [
          "Coaching is analysis and a plan to work on. Tallami doesn't promise a placement, a qualification or prize money: the result depends on your play and on each tournament.",
          "The results shown on this site belong to players Tallami has worked with, who agreed to have them shown. They don't predict yours.",
        ],
      },
      {
        heading: "Game rules",
        paragraphs: [
          "You agree to follow Epic Games' rules and the rules of each tournament. Tallami doesn't work with cheats, disallowed software, or shared or borrowed accounts.",
          "If a student breaks these rules, Tallami may end the service and refund the part that hasn't been used.",
          "Tallami Coaching is an independent service. Not affiliated with or endorsed by Epic Games. Fortnite is a trademark of Epic Games.",
        ],
      },
      {
        heading: "Temporada Pro",
        paragraphs: [
          "Entry to Temporada Pro is by application: the team sends a short form and Tallami writes back. Applying doesn't guarantee a spot.",
          `The list price is ${formatUsd(PRO_SEASON.priceUsd, "en")} per team for the whole season. If the team and Tallami agree to work together, that agreement sets what it includes, the amount, whether it's paid in parts and when a refund applies, always within what the law allows.`,
          `Each payment is made with a personal link that Tallami sends. The link works once and expires after ${PRO_LINK_DAYS} days.`,
        ],
      },
      {
        heading: "Liability and changes",
        paragraphs: [
          "Tallami is responsible for providing each service as these terms describe it. His liability has the limits that consumer protection law allows, and nothing in these terms limits the rights that law gives you.",
          "These terms may change. The date at the top says when they last changed. Each purchase is governed by the version in force on the day you made it: a new version applies to later purchases.",
        ],
      },
      {
        heading: "Law and complaints",
        paragraphs: [
          "These terms are governed by Argentine law, without taking away the rights that the consumer protection rules where you live give you.",
          "If you have a problem, write to Tallami first through the contact form, Monday to Friday, 10 am to 6 pm, Argentina time.",
          "If it isn't resolved, in Argentina you can file a complaint with the Ventanilla Federal Única de Reclamos de Defensa del Consumidor, the national consumer complaints office.",
        ],
      },
    ],
  },
};
