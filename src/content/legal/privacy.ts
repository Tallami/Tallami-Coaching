// Política de privacidad, en los tres idiomas. BORRADOR PARA EL ABOGADO. Dice lo que la web guarda
// de verdad: las tablas de `src/db/schema.ts`, las cookies del portal (`src/portal/`) y la del idioma
// (next-intl la pone solo al cambiar de idioma, y dura hasta cerrar el navegador). Si el código
// empieza a guardar otra cosa, esta página cambia con él.
//
// Los plazos que el código cumple salen de `src/portal/policy.ts` y `src/payments/policy.ts`. Los
// 400 días de los clics viven en `src/admin/interest/retention.ts`, que arrastra la base de datos:
// van escritos acá y `tests/unit/legal-content.test.ts` los compara con el código.

import type { Locale } from "@/i18n/routing";
import { PUBLIC_RECORD_RETENTION_MONTHS, UNPAID_ORDER_RETENTION_DAYS } from "@/payments/policy";
import { PORTAL_OAUTH_FLOW_MS, PORTAL_RECORD_RETENTION_MS, PORTAL_SESSION_MS } from "@/portal/policy";
import type { LegalDocument } from "./types";

const UPDATED_ON = "2026-11-13";
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const SESSION_DAYS = PORTAL_SESSION_MS / DAY_MS;
const SIGN_IN_MINUTES = PORTAL_OAUTH_FLOW_MS / MINUTE_MS;
/** La sesión más larga y el día que se guarda lo que ya no sirve: unos 31 días. */
const UNLINKED_ACCOUNT_DAYS = (PORTAL_SESSION_MS + PORTAL_RECORD_RETENTION_MS) / DAY_MS;
const UNPAID_ORDER_DAYS = UNPAID_ORDER_RETENTION_DAYS;
const PUBLIC_RECORD_MONTHS = PUBLIC_RECORD_RETENTION_MONTHS;
const CLICK_DAYS = 400;

export const PRIVACY: Record<Locale, LegalDocument> = {
  es: {
    title: "Política de privacidad",
    description: "Qué datos guarda esta web, para qué, por cuánto tiempo y quién más los ve.",
    updatedOn: UPDATED_ON,
    sections: [
      {
        heading: "Quién es responsable",
        paragraphs: [
          "El responsable de los datos que guarda esta web es Tomás Allami («Tallami»).",
          "Para cualquier consulta sobre tus datos, escribile desde el formulario de contacto de esta web.",
        ],
      },
      {
        heading: "Tu cuenta del portal",
        paragraphs: [
          "Cuando entrás con Discord o con Google se guarda: el proveedor, tu número de usuario en ese servicio, tu nombre para mostrar, tu email si el proveedor dice que está verificado, con Discord, tu nombre de usuario, y el idioma de la web cuando entraste (español, portugués o inglés), para escribirte los avisos en ese idioma.",
          "Sirve para que entres a tu portal y para que Tallami pueda escribirte. La cuenta no guarda tu contraseña, tu foto ni tu IP.",
        ],
      },
      {
        heading: "Tu ficha de alumno, tus compras y tus entregas",
        paragraphs: [
          "En tu ficha de alumno, Tallami guarda tu nombre, tu Discord, tu email, tu país y sus notas de trabajo, para darte el servicio.",
          "De cada compra se guarda qué compraste, cuánto pagaste en pesos y en dólares, el valor del dólar que se usó, el estado del pago y los datos de la factura. El pedido guarda además una copia de tu nombre, tu email y tu usuario de Discord, por si la cuenta se borra, y la hora en que confirmaste que el pago lo hace un adulto.",
          "De Mercado Pago llega solo el resultado del pago: su número, el estado, el monto y la fecha. Los datos de tu tarjeta nunca pasan por esta web.",
          "También se guardan los videos, PDF y links que te entrega Tallami, y los códigos de replay que pegás en tu compra, con la hora en que llegaron. Los códigos los ven solo vos y Tallami.",
          "Los mensajes que vos y Tallami se escriben en el portal se guardan para coordinar el servicio, y los leen solo ellos dos. Cuando uno escribe, al otro le llega un aviso por email que no trae el texto del mensaje.",
        ],
      },
      {
        heading: "Formularios y clics",
        paragraphs: [
          "Si aplicás a la Temporada Pro se guardan tu nombre, tu Discord, los integrantes del equipo, sus resultados y tu mensaje, para contestarte.",
          "Si usás el BOTÓN DE ARREPENTIMIENTO, el BOTÓN DE BAJA DE SERVICIO o el formulario de contacto, se guardan tu nombre, tu email, el número de compra si lo ponés, tu mensaje y el código del pedido.",
          "Cuando tocás el botón de un servicio se guarda, sin tu nombre, qué servicio, en qué idioma y desde qué país, y un código de la conexión que cambia cada día; nunca la IP. Sirve para saber qué servicios interesan.",
          "Las aplicaciones y los pedidos del sitio guardan ese mismo código de la conexión, para frenar el spam.",
        ],
      },
      {
        heading: "Cookies",
        paragraphs: [
          `La web usa solo cookies necesarias: la de tu sesión del portal, que dura ${SESSION_DAYS} días; la del paso de ingreso con Discord o Google, que dura ${SIGN_IN_MINUTES} minutos; y, si cambiás de idioma, una que lo recuerda hasta que cerrás el navegador.`,
          "No hay cookies de publicidad ni de estadísticas.",
        ],
      },
      {
        heading: "Cuánto tiempo se guarda",
        paragraphs: [
          `Una cuenta del portal que no está vinculada a ningún alumno se borra sola unos ${UNLINKED_ACCOUNT_DAYS} días después del último ingreso. Una cuenta vinculada queda hasta que pidas borrarla.`,
          `Los pedidos que no se pagaron se borran a los ${UNPAID_ORDER_DAYS} días, con su copia de tu nombre y tu email.`,
          `Las aplicaciones a la Temporada Pro y los pedidos del sitio se borran a los ${PUBLIC_RECORD_MONTHS} meses, o antes si Tallami los borra.`,
          `Los clics en los botones de los servicios se borran a los ${CLICK_DAYS} días.`,
          `Una conversación sin mensajes nuevos durante ${PUBLIC_RECORD_MONTHS} meses se borra sola, y podés pedir que se borre antes desde el formulario de contacto.`,
          "Las ventas y los pedidos pagados se guardan el tiempo que pidan las normas impositivas y de defensa del consumidor. Tu ficha de alumno y tus entregas quedan junto a tus ventas.",
        ],
      },
      {
        heading: "Quién más ve tus datos",
        paragraphs: [
          "Vercel aloja la web y recibe cada visita, con tu IP. La web corre en su región de San Pablo, Brasil.",
          "Supabase guarda la base de datos, también en San Pablo: todo lo que se describe arriba. Por eso tus datos se guardan en Brasil.",
          "Resend manda los emails de la web: ve tu email y el texto de cada email.",
          "Mercado Pago procesa el pago: recibe tus datos de pago directamente, sin pasar por esta web.",
          "Discord y Google te dejan entrar al portal: saben que entraste a esta web con tu cuenta.",
          "YouTube muestra los videos de tus entregas en modo sin cookies hasta que tocás play; desde ahí, YouTube sabe que mirás el video.",
          "jsDelivr sirve algunas imágenes de la portada, y ve la IP de quien la visita.",
          "Esta web no usa tus datos para publicidad.",
        ],
      },
      {
        heading: "Tus derechos",
        paragraphs: [
          "Podés pedir ver, corregir o borrar tus datos. Escribile a Tallami desde el formulario de contacto, de lunes a viernes, de 10 a 18, hora de Argentina.",
          "Lo que la ley obliga a guardar, como las ventas, se guarda ese tiempo aunque pidas borrarlo.",
        ],
      },
      {
        heading: "Autoridad de control",
        paragraphs: [
          "En Argentina, la Agencia de Acceso a la Información Pública (AAIP) controla el cumplimiento de la Ley 25.326 de protección de datos personales. Si creés que no se respetaron tus derechos, podés reclamar ante ella.",
        ],
      },
      {
        heading: "Menores de edad",
        paragraphs: [
          "Muchos alumnos son menores. Por eso la web guarda de cada uno solo lo necesario para el servicio, y el pago lo hace siempre un adulto responsable.",
          "Los formularios no piden la edad ni datos que el servicio no necesita.",
          "El chat del portal es solo para coordinar el servicio.",
        ],
      },
      {
        heading: "Cambios",
        paragraphs: ["Si esta política cambia, se actualiza la fecha de arriba."],
      },
    ],
  },
  pt: {
    title: "Política de privacidade",
    description: "Quais dados este site guarda, para quê, por quanto tempo e quem mais os vê.",
    updatedOn: UPDATED_ON,
    sections: [
      {
        heading: "Quem é o responsável",
        paragraphs: [
          "O responsável pelos dados que este site guarda é Tomás Allami (“Tallami”).",
          "Para qualquer dúvida sobre os seus dados, escreva para ele pelo formulário de contato deste site.",
        ],
      },
      {
        heading: "Sua conta do portal",
        paragraphs: [
          "Quando você entra com Discord ou com Google, são guardados: o provedor, o seu número de usuário nesse serviço, o seu nome de exibição, o seu e-mail se o provedor disser que está verificado, com Discord, o seu nome de usuário, e o idioma do site quando você entrou (espanhol, português ou inglês), para escrever os avisos nesse idioma.",
          "Isso serve para você entrar no seu portal e para o Tallami poder escrever para você. A conta não guarda a sua senha, a sua foto nem o seu IP.",
        ],
      },
      {
        heading: "Sua ficha de aluno, suas compras e suas entregas",
        paragraphs: [
          "Na sua ficha de aluno, o Tallami guarda o seu nome, o seu Discord, o seu e-mail, o seu país e as anotações de trabalho dele, para prestar o serviço.",
          "De cada compra se guarda o que você comprou, quanto pagou em pesos e em dólares, o valor do dólar usado, o status do pagamento e os dados da nota fiscal. O pedido também guarda uma cópia do seu nome, do seu e-mail e do seu usuário do Discord, caso a conta seja apagada, e a hora em que você confirmou que o pagamento é feito por um adulto.",
          "Do Mercado Pago chega só o resultado do pagamento: o número, o status, o valor e a data. Os dados do seu cartão nunca passam por este site.",
          "Também são guardados os vídeos, PDFs e links que o Tallami entrega, e os códigos de replay que você cola na sua compra, com a hora em que chegaram. Os códigos só você e o Tallami veem.",
          "As mensagens que você e o Tallami escrevem um para o outro no portal são guardadas para combinar o serviço, e só os dois as leem. Quando um escreve, o outro recebe um aviso por e-mail que não traz o texto da mensagem.",
        ],
      },
      {
        heading: "Formulários e cliques",
        paragraphs: [
          "Se você se candidata à Temporada Pro, são guardados o seu nome, o seu Discord, os integrantes da equipe, os resultados e a sua mensagem, para responder a você.",
          "Se você usa o BOTÓN DE ARREPENTIMIENTO, o BOTÓN DE BAJA DE SERVICIO ou o formulário de contato, são guardados o seu nome, o seu e-mail, o número da compra se você o informar, a sua mensagem e o código do pedido.",
          "Quando você toca o botão de um serviço, é guardado, sem o seu nome, qual serviço, em qual idioma e de qual país, e um código da conexão que muda todo dia; nunca o IP. Isso serve para saber quais serviços interessam.",
          "As candidaturas e os pedidos do site guardam esse mesmo código da conexão, para frear o spam.",
        ],
      },
      {
        heading: "Cookies do site",
        paragraphs: [
          `O site usa só cookies necessários: o da sua sessão do portal, que dura ${SESSION_DAYS} dias; o da etapa de entrada com Discord ou Google, que dura ${SIGN_IN_MINUTES} minutos; e, se você muda de idioma, um que o lembra até você fechar o navegador.`,
          "Não há cookies de publicidade nem de estatísticas.",
        ],
      },
      {
        heading: "Por quanto tempo é guardado",
        paragraphs: [
          `Uma conta do portal que não está vinculada a nenhum aluno é apagada sozinha cerca de ${UNLINKED_ACCOUNT_DAYS} dias depois da última entrada. Uma conta vinculada fica até você pedir para apagá-la.`,
          `Os pedidos que não foram pagos são apagados em ${UNPAID_ORDER_DAYS} dias, com a cópia do seu nome e do seu e-mail.`,
          `As candidaturas à Temporada Pro e os pedidos do site são apagados em ${PUBLIC_RECORD_MONTHS} meses, ou antes se o Tallami os apagar.`,
          `Os cliques nos botões dos serviços são apagados em ${CLICK_DAYS} dias.`,
          `Uma conversa sem mensagens novas por ${PUBLIC_RECORD_MONTHS} meses é apagada sozinha, e você pode pedir que seja apagada antes pelo formulário de contato.`,
          "As vendas e os pedidos pagos são guardados pelo tempo que as normas fiscais e de defesa do consumidor exigirem. A sua ficha de aluno e as suas entregas ficam junto com as suas vendas.",
        ],
      },
      {
        heading: "Quem mais vê os seus dados",
        paragraphs: [
          "A Vercel hospeda o site e recebe cada visita, com o seu IP. O site roda na região de São Paulo, Brasil, da Vercel.",
          "O Supabase guarda o banco de dados, também em São Paulo: tudo o que está descrito acima. Por isso os seus dados ficam guardados no Brasil.",
          "O Resend envia os e-mails do site: vê o seu e-mail e o texto de cada e-mail.",
          "O Mercado Pago processa o pagamento: recebe os seus dados de pagamento diretamente, sem passar por este site.",
          "O Discord e o Google permitem a sua entrada no portal: sabem que você entrou neste site com a sua conta.",
          "O YouTube mostra os vídeos das suas entregas em modo sem cookies até você tocar no play; a partir daí, o YouTube sabe que você assiste ao vídeo.",
          "O jsDelivr serve algumas imagens da página inicial e vê o IP de quem a visita.",
          "Este site não usa os seus dados para publicidade.",
        ],
      },
      {
        heading: "Seus direitos",
        paragraphs: [
          "Você pode pedir para ver, corrigir ou apagar os seus dados. Escreva para o Tallami pelo formulário de contato, de segunda a sexta, das 10h às 18h, horário da Argentina.",
          "O que a lei obriga a guardar, como as vendas, fica guardado por esse tempo mesmo que você peça para apagar.",
        ],
      },
      {
        heading: "Autoridade de controle",
        paragraphs: [
          "Na Argentina, a Agencia de Acceso a la Información Pública (AAIP) fiscaliza o cumprimento da Lei 25.326 de proteção de dados pessoais. Se você acha que os seus direitos não foram respeitados, pode reclamar junto a ela.",
        ],
      },
      {
        heading: "Menores de idade",
        paragraphs: [
          "Muitos alunos são menores de idade. Por isso o site guarda de cada um só o necessário para o serviço, e o pagamento é sempre feito por um adulto responsável.",
          "Os formulários não pedem a idade nem dados de que o serviço não precisa.",
          "O chat do portal serve só para combinar o serviço.",
        ],
      },
      {
        heading: "Mudanças",
        paragraphs: ["Se esta política mudar, a data no topo é atualizada."],
      },
    ],
  },
  en: {
    title: "Privacy policy",
    description: "What data this site keeps, what for, for how long and who else sees it.",
    updatedOn: UPDATED_ON,
    sections: [
      {
        heading: "Who is responsible",
        paragraphs: [
          "The person responsible for the data this site keeps is Tomás Allami (“Tallami”).",
          "For any question about your data, write to him through this site's contact form.",
        ],
      },
      {
        heading: "Your portal account",
        paragraphs: [
          "When you sign in with Discord or Google, the site keeps: the provider, your user number on that service, your display name, your email if the provider says it's verified, with Discord, your username, and the site's language when you signed in (Spanish, Portuguese or English), so notices reach you in that language.",
          "This lets you sign in to your portal and lets Tallami write to you. The account doesn't keep your password, your picture or your IP.",
        ],
      },
      {
        heading: "Your student file, purchases and deliveries",
        paragraphs: [
          "In your student file, Tallami keeps your name, your Discord, your email, your country and his working notes, to provide the service.",
          "For each purchase the site keeps what you bought, how much you paid in pesos and in dollars, the dollar rate used, the payment status and the invoice details. The order also keeps a copy of your name, your email and your Discord username, in case the account is deleted, and the time you confirmed that an adult is making the payment.",
          "From Mercado Pago only the payment result arrives: its number, status, amount and date. Your card details never go through this site.",
          "The site also keeps the videos, PDFs and links Tallami delivers, and the replay codes you paste into your purchase, with the time they arrived. Only you and Tallami see the codes.",
          "The messages you and Tallami write to each other in the portal are kept to arrange the service, and only the two of you read them. When one writes, the other gets an email notice that doesn't include the text of the message.",
        ],
      },
      {
        heading: "Forms and clicks",
        paragraphs: [
          "If you apply to Temporada Pro, the site keeps your name, your Discord, the team members, their results and your message, to reply to you.",
          "If you use the BOTÓN DE ARREPENTIMIENTO, the BOTÓN DE BAJA DE SERVICIO or the contact form, the site keeps your name, your email, the purchase number if you give it, your message and the request code.",
          "When you tap a service's button, the site keeps, without your name, which service, in which language and from which country, plus a code for the connection that changes every day; never the IP. It shows which services people are interested in.",
          "Applications and site requests keep that same connection code, to stop spam.",
        ],
      },
      {
        heading: "Site cookies",
        paragraphs: [
          `The site only uses necessary cookies: your portal session cookie, which lasts ${SESSION_DAYS} days; the one for the Discord or Google sign-in step, which lasts ${SIGN_IN_MINUTES} minutes; and, if you switch language, one that remembers it until you close the browser.`,
          "There are no advertising or analytics cookies.",
        ],
      },
      {
        heading: "How long it is kept",
        paragraphs: [
          `A portal account that isn't linked to any student deletes itself about ${UNLINKED_ACCOUNT_DAYS} days after the last sign-in. A linked account stays until you ask to delete it.`,
          `Orders that were never paid are deleted after ${UNPAID_ORDER_DAYS} days, with the copy of your name and email.`,
          `Temporada Pro applications and site requests are deleted after ${PUBLIC_RECORD_MONTHS} months, or sooner if Tallami deletes them.`,
          `Clicks on the service buttons are deleted after ${CLICK_DAYS} days.`,
          `A conversation with no new messages for ${PUBLIC_RECORD_MONTHS} months deletes itself, and you can ask for it to be deleted sooner through the contact form.`,
          "Sales and paid orders are kept for as long as tax and consumer protection rules require. Your student file and your deliveries stay with your sales.",
        ],
      },
      {
        heading: "Who else sees your data",
        paragraphs: [
          "Vercel hosts the site and receives every visit, with your IP. The site runs in its São Paulo, Brazil region.",
          "Supabase keeps the database, also in São Paulo: everything described above. That's why your data is stored in Brazil.",
          "Resend sends the site's emails: it sees your email and the text of each email.",
          "Mercado Pago processes the payment: it receives your payment details directly, without going through this site.",
          "Discord and Google let you sign in to the portal: they know you signed in to this site with your account.",
          "YouTube shows the videos of your deliveries in no-cookie mode until you press play; from then on, YouTube knows you're watching the video.",
          "jsDelivr serves some images on the home page, and sees the IP of whoever visits it.",
          "This site doesn't use your data for advertising.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "You can ask to see, correct or delete your data. Write to Tallami through the contact form, Monday to Friday, 10 am to 6 pm, Argentina time.",
          "What the law requires to be kept, such as sales, is kept for that time even if you ask to delete it.",
        ],
      },
      {
        heading: "Supervisory authority",
        paragraphs: [
          "In Argentina, the Agencia de Acceso a la Información Pública (AAIP) oversees compliance with Law 25.326 on personal data protection. If you think your rights weren't respected, you can file a complaint with it.",
        ],
      },
      {
        heading: "Minors",
        paragraphs: [
          "Many students are minors. That's why the site keeps only what the service needs about each one, and payment is always made by a responsible adult.",
          "The forms don't ask for age or for data the service doesn't need.",
          "The portal chat is only for arranging the service.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: ["If this policy changes, the date at the top is updated."],
      },
    ],
  },
};
