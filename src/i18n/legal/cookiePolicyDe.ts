import type { LegalDocumentPageTranslations } from './types'
import { legalContactDe } from './contactDe'

export const cookiePolicyDe: LegalDocumentPageTranslations = {
  title: 'Cookie-Richtlinie',
  lastUpdated: 'Zuletzt aktualisiert: 8. Juni 2026',
  intro:
    'Diese Cookie-Richtlinie erläutert, wie Tartarix, Inc. („wir“, „uns“ oder „unser“) Cookies und ähnliche Technologien auf den UniCopier-Websites und -Anwendungen einsetzt. Sie sollte zusammen mit unserer Datenschutzerklärung gelesen werden.',
  sections: [
    {
      title: '1. Was sind Cookies?',
      paragraphs: [
        'Cookies sind kleine Textdateien, die auf Ihrem Gerät gespeichert werden, wenn Sie eine Website besuchen. Ähnliche Technologien umfassen Local Storage, Session Storage und Pixel. Sie helfen Websites, Präferenzen zu speichern, Sie angemeldet zu halten und zu verstehen, wie der Dienst genutzt wird.',
      ],
    },
    {
      title: '2. Wie wir Cookies verwenden',
      paragraphs: [
        'Notwendige Cookies: erforderlich für Authentifizierung, Sicherheit, Empfehlungszuordnung und Kernfunktionalität (z. B. Sitzungszustand, Auth-Präsenz über Subdomänen hinweg, sofern konfiguriert). Diese können während der Nutzung des Dienstes nicht deaktiviert werden.',
        'Präferenz-Cookies: merken sich Auswahlen wie Sprache, Cookie-Einwilligungsstatus und geschlossene Banner.',
        'Analyse-Cookies: Wenn Sie Cookies in unserem Banner akzeptieren, können wir Google Analytics und zugehörige Kennungen verwenden, um Datenverkehr und Funktionsnutzung zu verstehen. Analyse-Eignisse können Seitenpfade, Empfehlungscodes und pseudonyme IDs enthalten — nicht Ihre Broker-Passwörter oder Handelsanweisungen.',
      ],
    },
    {
      title: '3. Cookies, die wir setzen',
      paragraphs: [
        'Beispiele: Authentifizierungs-/Sitzungs-Cookies von unserem Auth-Anbieter; tsc_tracking_consent und tsc_tracking_seen_ts (Ihre Auswahl im Cookie-Banner); tsc_analytics_id (pseudonyme Analyse-ID, wenn die Analyse läuft); tsc_ref und tsc_ref_ts (Empfehlungszuordnung); tsc_auth (kurzlebiger Anmeldehinweis über Subdomänen hinweg, wo aktiviert).',
        'Namen und Laufzeiten können sich ändern, wenn wir den Dienst verbessern. Notwendige Cookies verfallen in der Regel beim Abmelden oder nach einer festgelegten Sicherheitsfrist.',
      ],
    },
    {
      title: '4. Cookies Dritter',
      paragraphs: [
        'Dritte wie Google (Analytics), Stripe (Checkout) und unsere Hosting-Anbieter können eigene Cookies setzen, wenn Sie mit deren Funktionen interagieren. Ihre Verwendung unterliegt deren Richtlinien.',
      ],
    },
    {
      title: '5. Ihre Wahlmöglichkeiten',
      paragraphs: [
        'Bei Ihrem ersten Besuch können Sie in unserem Cookie-Banner nicht notwendiges Tracking akzeptieren oder ablehnen. Sie können Ihre Browsereinstellungen ändern, um Cookies zu blockieren oder zu löschen; das Blockieren notwendiger Cookies kann die Anmeldung oder Kernfunktionen beeinträchtigen.',
        'Um Google Analytics in unterstützten Regionen abzuschalten, können Sie auch den Browser-Add-on von Google oder die Datenschutzsteuerung Ihres Browsers verwenden.',
      ],
    },
    {
      title: '6. Aktualisierungen',
      paragraphs: [
        'Wir können diese Cookie-Richtlinie von Zeit zu Zeit aktualisieren. Das Datum „Zuletzt aktualisiert“ oben gibt die neueste Version wieder.',
      ],
    },
  ],
  closing:
    'Fragen zu Cookies? Kontaktieren Sie legal@tscopier.ai oder lesen Sie unsere Datenschutzerklärung.',
  contact: legalContactDe,
}
