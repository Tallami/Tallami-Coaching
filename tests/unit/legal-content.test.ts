import { describe, expect, test } from "vitest";
import { INTEREST_RETENTION_DAYS } from "@/admin/interest/retention";
import { PRIVACY } from "@/content/legal/privacy";
import { REFUNDS } from "@/content/legal/refunds";
import { TERMS } from "@/content/legal/terms";
import type { LegalDocument } from "@/content/legal/types";
import { routing, type Locale } from "@/i18n/routing";
import {
  PUBLIC_RECORD_RETENTION_MONTHS,
  PURCHASE_EXPIRY_DAYS,
  REPLAY_DELIVERY_HOURS,
  UNPAID_ORDER_RETENTION_DAYS,
} from "@/payments/policy";
import { PORTAL_OAUTH_FLOW_MS, PORTAL_RECORD_RETENTION_MS, PORTAL_SESSION_MS } from "@/portal/policy";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import pt from "../../messages/pt.json";

// Términos, reembolsos y privacidad son borradores para el abogado, pero se publican: tienen que
// decir lo que la web hace de verdad, con los números del código, y nunca lo que la norma prohíbe
// (renunciar al arrepentimiento) ni lo que Tallami no quiere mostrar (su email, su CUIT, su dirección).
// Las mismas reglas valen para todos los textos del sitio (`messages/*.json`).

const DOCUMENTS = { terms: TERMS, refunds: REFUNDS, privacy: PRIVACY } as const;
const DOCUMENT_NAMES = Object.keys(DOCUMENTS) as (keyof typeof DOCUMENTS)[];
const LOCALES = routing.locales;
const CATALOGS = { es, pt, en } as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const CUIT = /\b\d{2}-?\d{8}-?\d\b/;
/** Lo que delata una dirección postal en los tres idiomas: calle, piso, código postal, domicilio. */
const POSTAL_ADDRESS =
  /\b(?:av(?:enida)?\.\s|calle\s|piso\s\d|depto\.?|dpto\.?|c[oó]digo postal|domicilio|endere[cç]o|rua\s|street\b|avenue\b|zip code|postal code)|\b[A-Z]\d{4}[A-Z]{3}\b/i;
/** "Sin reembolsos" y parecidos: el derecho de arrepentimiento no se puede renunciar. */
const NO_REFUNDS =
  /sin reembolsos?|no hay reembolsos?|no (?:se )?reembolsa|no reembolsable|todas las ventas son finales|no refunds?|non-refundable|all sales (?:are )?final|sem reembolsos?|n[aã]o h[aá] reembolsos?|n[aã]o reembols[aá]vel|todas as vendas s[aã]o finais/i;

/** Todo lo que se lee de un documento, en un solo texto. */
function textOf(document: LegalDocument): string {
  return [
    document.title,
    document.description,
    ...document.sections.flatMap(({ heading, paragraphs }) => [heading, ...paragraphs]),
  ].join("\n");
}

type Messages = { [key: string]: string | Messages };

function leavesOf(messages: Messages, prefix = ""): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value] as [string, string]] : leavesOf(value, path);
  });
}

/** Cada texto publicado: los tres documentos en los tres idiomas y todos los mensajes. */
const PUBLISHED: [string, string][] = [
  ...DOCUMENT_NAMES.flatMap((name) => LOCALES.map((locale) => [`${name}.${locale}`, textOf(DOCUMENTS[name][locale])] as [string, string])),
  ...LOCALES.flatMap((locale) => leavesOf(CATALOGS[locale] as Messages).map(([path, value]) => [`messages.${locale}.${path}`, value] as [string, string])),
];

describe("what no published text says", () => {
  test("covers the three documents in the three languages and every message", () => {
    expect(PUBLISHED.length).toBeGreaterThan(DOCUMENT_NAMES.length * LOCALES.length + 300);
  });

  test.each(PUBLISHED)("%s shows no email address, CUIT or postal address", (_name, text) => {
    expect(text).not.toMatch(EMAIL_ADDRESS);
    expect(text).not.toMatch(CUIT);
    expect(text).not.toMatch(POSTAL_ADDRESS);
  });

  test.each(PUBLISHED)("%s never says there are no refunds", (_name, text) => {
    expect(text).not.toMatch(NO_REFUNDS);
  });

  test("the checks do catch what they look for", () => {
    expect("escribime a tallami@gmail.com").toMatch(EMAIL_ADDRESS);
    expect("CUIT 20-12345678-9").toMatch(CUIT);
    expect("CUIT 20123456789").toMatch(CUIT);
    expect("Av. Corrientes 1234, piso 3").toMatch(POSTAL_ADDRESS);
    expect("C1425ABC").toMatch(POSTAL_ADDRESS);
    for (const phrase of ["Sin reembolsos.", "No hay reembolso", "No refunds", "Sem reembolso", "Todas las ventas son finales"]) {
      expect(phrase).toMatch(NO_REFUNDS);
    }
  });
});

describe("the legal documents", () => {
  test.each(DOCUMENT_NAMES)("%s exists in every language, with title, description, an ISO date and sections with text", (name) => {
    for (const locale of LOCALES) {
      const document = DOCUMENTS[name][locale];
      expect(document.title.trim(), `${name}.${locale}`).not.toBe("");
      expect(document.description.trim(), `${name}.${locale}`).not.toBe("");
      expect(document.updatedOn, `${name}.${locale}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${document.updatedOn}T00:00:00Z`))).toBe(false);
      expect(document.sections.length).toBeGreaterThan(0);
      for (const { heading, paragraphs } of document.sections) {
        expect(heading.trim(), `${name}.${locale}`).not.toBe("");
        expect(paragraphs.length, `${name}.${locale}: ${heading}`).toBeGreaterThan(0);
        for (const paragraph of paragraphs) expect(paragraph.trim(), `${name}.${locale}: ${heading}`).not.toBe("");
      }
    }
  });

  test.each(DOCUMENT_NAMES)("%s has the same sections, paragraphs and date in the three languages", (name) => {
    const shape = (locale: Locale) => DOCUMENTS[name][locale].sections.map(({ paragraphs }) => paragraphs.length);
    for (const locale of LOCALES) {
      expect(shape(locale), `${name}.${locale}`).toEqual(shape("es"));
      expect(DOCUMENTS[name][locale].updatedOn, `${name}.${locale}`).toBe(DOCUMENTS[name].es.updatedOn);
    }
  });

  test.each(DOCUMENT_NAMES)("%s has headings that are not repeated, so each one can be found from the index", (name) => {
    for (const locale of LOCALES) {
      const headings = DOCUMENTS[name][locale].sections.map(({ heading }) => heading);
      expect(new Set(headings).size, `${name}.${locale}`).toBe(headings.length);
    }
  });

  test.each(DOCUMENT_NAMES)("%s in pt and en is not the Spanish copied", (name) => {
    const spanish = DOCUMENTS[name].es;
    for (const locale of ["pt", "en"] as const) {
      const translated = DOCUMENTS[name][locale];
      expect(translated.title).not.toBe(spanish.title);
      translated.sections.forEach((section, index) => {
        // "Temporada Pro" es un nombre propio: se llama igual en los tres idiomas.
        if (section.heading !== "Temporada Pro") {
          expect(section.heading, `${name}.${locale} #${index + 1}`).not.toBe(spanish.sections[index].heading);
        }
        section.paragraphs.forEach((paragraph, at) => {
          expect(paragraph, `${name}.${locale} #${index + 1}.${at + 1}`).not.toBe(spanish.sections[index].paragraphs[at]);
        });
      });
    }
  });

  test.each(DOCUMENT_NAMES)("%s in Spanish uses voseo, never `tú`", (name) => {
    // Formas de `tú` que no se confunden con otra palabra ("compras" también es el plural de compra).
    expect(textOf(DOCUMENTS[name].es)).not.toMatch(/\btú\b|\b(?:tienes|puedes|quieres|eres|debes|sabes|haces|usas|necesitas|avisas|eliges)\b/i);
  });
});

describe("the terms", () => {
  const spanish = textOf(TERMS.es);

  test("have the fourteen clauses of the design", () => {
    expect(TERMS.es.sections).toHaveLength(14);
  });

  test("in Spanish name the seller and every rule with its number", () => {
    expect(spanish).toContain("Tomás Allami");
    expect(spanish).toContain("«Tallami»");
    expect(spanish).toMatch(/\b10 días\b/);
    expect(spanish).toMatch(/\b13 años\b/);
    expect(spanish).toContain(`${PURCHASE_EXPIRY_DAYS} días`);
    expect(spanish).toMatch(/\b24 horas\b/);
    expect(spanish).toMatch(/\b15 minutos\b/);
    expect(spanish).toContain(`${REPLAY_DELIVERY_HOURS.vodRecorded} horas`);
    expect(spanish).toContain(`${REPLAY_DELIVERY_HOURS.tournamentReview} horas`);
    expect(spanish).toContain("Mercado Pago");
    expect(spanish).toMatch(/No afiliado[^.]*Epic Games/);
    expect(spanish).toContain("Ventanilla Federal Única de Reclamos de Defensa del Consumidor");
    // Remite a la página de reembolsos y a los dos botones, con el nombre que les da la norma.
    expect(spanish).toContain("BOTÓN DE ARREPENTIMIENTO");
    expect(spanish).toContain("BOTÓN DE BAJA DE SERVICIO");
  });

  test.each(LOCALES)("in %s keep the names and the numbers of the Spanish", (locale) => {
    const text = textOf(TERMS[locale]);
    for (const name of ["Tomás Allami", "Tallami", "Mercado Pago", "Epic Games", "Discord", "Google", "YouTube"]) {
      expect(text, name).toContain(name);
    }
    for (const number of [10, 13, 15, 24, PURCHASE_EXPIRY_DAYS, REPLAY_DELIVERY_HOURS.vodRecorded, REPLAY_DELIVERY_HOURS.tournamentReview]) {
      expect(text, String(number)).toMatch(new RegExp(`\\b${number}\\b`));
    }
  });
});

describe("the refund policy", () => {
  test("in Spanish has the 10 days, when each service counts as used, the session rules, the expiry and how the money goes back", () => {
    const spanish = textOf(REFUNDS.es);

    expect(spanish).toMatch(/\b10 días\b/);
    for (const service of ["VOD review de 3 partidas", "VOD review de torneo completo", "VOD review en vivo", "Plan de juego", "Temporada Pro"]) {
      expect(spanish, service).toContain(service);
    }
    expect(spanish).toMatch(/\b24 horas\b/);
    expect(spanish).toMatch(/\b15 minutos\b/);
    expect(spanish).toContain(`${PURCHASE_EXPIRY_DAYS} días`);
    expect(spanish).toContain("Mercado Pago");
    expect(spanish).toMatch(/pesos/);
    expect(spanish).toContain("BOTÓN DE ARREPENTIMIENTO");
  });

  test.each(LOCALES)("in %s keep the numbers and the button name", (locale) => {
    const text = textOf(REFUNDS[locale]);
    for (const number of [10, 15, 24, PURCHASE_EXPIRY_DAYS]) expect(text, String(number)).toMatch(new RegExp(`\\b${number}\\b`));
    expect(text).toContain("Mercado Pago");
    expect(text).toContain("BOTÓN DE ARREPENTIMIENTO");
  });
});

describe("the privacy policy", () => {
  const COMPANIES = ["Vercel", "Supabase", "Resend", "Mercado Pago", "Discord", "Google", "YouTube", "jsDelivr"] as const;
  /** Cuánto dura cada cosa, del código: sesión, paso de ingreso, cuenta sin vincular, pedidos, aplicaciones, clics. */
  const SESSION_DAYS = PORTAL_SESSION_MS / DAY_MS;
  const SIGN_IN_MINUTES = PORTAL_OAUTH_FLOW_MS / MINUTE_MS;
  const UNLINKED_ACCOUNT_DAYS = (PORTAL_SESSION_MS + PORTAL_RECORD_RETENTION_MS) / DAY_MS;

  test("the numbers it uses are the ones in the code", () => {
    expect([SESSION_DAYS, SIGN_IN_MINUTES, UNLINKED_ACCOUNT_DAYS]).toEqual([30, 10, 31]);
    expect([UNPAID_ORDER_RETENTION_DAYS, PUBLIC_RECORD_RETENTION_MONTHS, INTEREST_RETENTION_DAYS]).toEqual([90, 24, 400]);
  });

  test("in Spanish names who handles the data, the authority and how long each thing stays", () => {
    const spanish = textOf(PRIVACY.es);

    expect(spanish).toContain("Tomás Allami");
    for (const company of COMPANIES) expect(spanish, company).toContain(company);
    expect(spanish).toContain("AAIP");
    expect(spanish).toContain("San Pablo");
    expect(spanish).toContain(`${UNPAID_ORDER_RETENTION_DAYS} días`);
    expect(spanish).toContain(`${PUBLIC_RECORD_RETENTION_MONTHS} meses`);
    expect(spanish).toContain(`${INTEREST_RETENTION_DAYS} días`);
    expect(spanish).toContain(`${SESSION_DAYS} días`);
    expect(spanish).toContain(`${SIGN_IN_MINUTES} minutos`);
    expect(spanish).toContain(`${UNLINKED_ACCOUNT_DAYS} días`);
    // Nunca datos de tarjeta, y los derechos se piden por el formulario de contacto.
    expect(spanish).toMatch(/tarjeta/);
    expect(spanish).toMatch(/formulario de contacto/);
    expect(spanish).toMatch(/menores/);
  });

  test.each(LOCALES)("in %s names the same companies, the authority and the same periods", (locale) => {
    const text = textOf(PRIVACY[locale]);
    for (const company of [...COMPANIES, "AAIP"]) expect(text, company).toContain(company);
    for (const number of [SESSION_DAYS, SIGN_IN_MINUTES, UNLINKED_ACCOUNT_DAYS, UNPAID_ORDER_RETENTION_DAYS, PUBLIC_RECORD_RETENTION_MONTHS, INTEREST_RETENTION_DAYS]) {
      expect(text, String(number)).toMatch(new RegExp(`\\b${number}\\b`));
    }
  });
});

describe("the portal chat in the legal texts", () => {
  const privacy = textOf(PRIVACY.es);
  const terms = textOf(TERMS.es);

  test("the privacy policy in Spanish names the messages, who reads them and the 24 months", () => {
    expect(privacy).toMatch(/mensajes que .* se escriben en el portal/);
    expect(privacy).toMatch(/los leen solo ellos dos/);
    expect(privacy).toMatch(/conversación sin mensajes nuevos durante 24 meses/);
    expect(privacy).toMatch(/aviso por email que no trae el texto/);
    expect(privacy).toMatch(/chat del portal es solo para coordinar/);
  });

  test("the terms in Spanish say the live sessions are arranged in the portal chat", () => {
    expect(terms).toMatch(/chat del portal/);
    expect(terms).not.toMatch(/se coordinan por mensaje/);
  });

  test.each([
    ["es", /Resend .*el texto de cada email\./, /el texto de cada mensaje/],
    ["pt", /Resend .*o texto de cada e-mail\./, /o texto de cada mensagem/],
    ["en", /Resend .*the text of each email\./, /the text of each message/],
  ] as const)("in %s, Resend sees the text of each email, never said of the chat messages", (locale, says, never) => {
    const text = textOf(PRIVACY[locale]);
    expect(text).toMatch(says);
    expect(text).not.toMatch(never);
  });

  test.each([
    ["es", "Tu cuenta del portal", /idioma de la web/],
    ["pt", "Sua conta do portal", /idioma do site/],
    ["en", "Your portal account", /site's language/],
  ] as const)("in %s, the portal account section lists the site language among what it keeps", (locale, heading, language) => {
    const section = PRIVACY[locale].sections.find((candidate) => candidate.heading === heading);
    expect(section?.paragraphs[0]).toMatch(language);
  });

  test.each(LOCALES)("the documents in %s were updated after the chat", (locale) => {
    // La privacidad cambió de nuevo el 13 (Resend y el idioma de la cuenta); los términos, no.
    expect(PRIVACY[locale].updatedOn).toBe("2026-11-13");
    expect(TERMS[locale].updatedOn).toBe("2026-11-12");
  });
});
