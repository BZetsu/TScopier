import type { LegalDocumentPageTranslations } from './types'
import { legalContactDe } from './contactDe'

export const privacyPolicyDe: LegalDocumentPageTranslations = {
  title: 'Datenschutzerklärung',
  lastUpdated: 'Zuletzt aktualisiert: 8. Juni 2026',
  intro:
    'Tartarix, Inc. („Tartarix“, „wir“, „uns“ oder „unser“) respektiert Ihre Privatsphäre. Diese Datenschutzerklärung erläutert, wie wir Informationen erheben, verwenden, offenlegen und schützen, wenn Sie die UniCopier-Websites und -Anwendungen nutzen (der „Dienst“).',
  sections: [
    {
      title: '1. Informationen, die wir erheben',
      paragraphs: [
        'Kontoinformationen: Name, E-Mail-Adresse, Passwort-Hash, Sprach- und Profilpräferenzen, Abonnementstatus und Empfehlungscodes.',
        'Broker- und Handelskonfiguration: Broker-Bezeichnungen, Konten-Logins (keine im Klartext gespeicherten Passwörter), Plattformtyp, Kanalauswahl, Copier-Einstellungen und Ausführungsprotokolle, die für den Betrieb des Dienstes erforderlich sind.',
        'Handels- und Signaldaten: Telegram-Kanal-IDs, verarbeitete Signalinhalte, Handelsaufzeichnungen, Übersprunggründe und Performance-Kennzahlen, die mit Ihrem Konto verknüpft sind.',
        'Zahlungsinformationen: Abrechnungsstatus und Kundenkennungen von unserem Zahlungsdienstleister. Kartendetails werden vom Dienstleister verarbeitet, nicht von uns gespeichert.',
        'Technische Daten: IP-Adresse, Browsertyp, Geräteinformationen, Cookies, Analyse-Kennungen und Nutzungseignisse (siehe unsere Cookie-Richtlinie).',
        'Kommunikation: Nachrichten, die Sie an die E-Mail-Adressen für Support, Rechtliches oder Streitigkeiten senden.',
      ],
    },
    {
      title: '2. Wie wir Informationen verwenden',
      paragraphs: [
        'Bereitstellen, pflegen und verbessern des Dienstes; Authentifizierung der Nutzer; Verarbeitung von Abonnements; Ausführung konfigurierter Kopierhandels-Vorgänge; Anzeige von Dashboards und Protokollen.',
        'Versenden von transaktionsbezogenen E-Mails (Verifizierung, Abrechnung, Sicherheitshinweise) und Beantwortung von Supportanfragen.',
        'Überwachung der Zuverlässigkeit, Verhinderung von Betrug und Missbrauch, Durchsetzung unserer Bedingungen und Erfüllung gesetzlicher Verpflichtungen.',
        'Auswertung aggregierter Nutzungsdaten zur Verbesserung der Produktfunktionen (vorbehaltlich Ihrer Cookie-Auswahl, sofern zutreffend).',
      ],
    },
    {
      title: '3. Rechtsgrundlagen (Nutzer im EWR/UK)',
      paragraphs: [
        'Wo die DSGVO oder ähnliche Gesetze gelten, verarbeiten wir personenbezogene Daten auf Grundlage von: Vertragserfüllung (Bereitstellung des Dienstes), berechtigten Interessen (Sicherheit, Analyse, Produktverbesserung), Einwilligung (nicht notwendige Cookies/Marketing, sofern erforderlich) und gesetzlicher Verpflichtung.',
      ],
    },
    {
      title: '4. Wie wir Informationen weitergeben',
      paragraphs: [
        'Dienstleister: Hosting und Datenbank (z. B. Supabase), Zahlungsabwicklung (z. B. Stripe), E-Mail-Versand, Analyse (z. B. Google Analytics bei erteilter Einwilligung), Broker-Konnexitäts-APIs und Support-Tools — nur soweit erforderlich, um den Dienst zu betreiben.',
        'Wir verkaufen Ihre personenbezogenen Daten nicht. Wir können Informationen offenlegen, wenn dies gesetzlich erforderlich ist, zum Schutz von Rechten und Sicherheit oder im Zusammenhang mit einer Fusion, Übernahme oder Vermögensveräußerung mit angemessenen Schutzmaßnahmen.',
      ],
    },
    {
      title: '5. Übermittlungen ins Ausland',
      paragraphs: [
        'Wir können Informationen in den Vereinigten Staaten und anderen Ländern verarbeiten und speichern, in denen wir oder unsere Dienstleister tätig sind. Wir verwenden angemessene Schutzmaßnahmen für grenzüberschreitende Übermittlungen, soweit gesetzlich erforderlich.',
      ],
    },
    {
      title: '6. Aufbewahrung',
      paragraphs: [
        'Wir bewahren Informationen auf, solange Ihr Konto aktiv ist und soweit erforderlich, um den Dienst bereitzustellen, Streitigkeiten zu klären, Vereinbarungen durchzusetzen und gesetzliche Anforderungen zu erfüllen. Sie können die Löschung beantragen, vorbehaltlich von Ausnahmen (z. B. Abrechnungsunterlagen, die wir aufbewahren müssen).',
      ],
    },
    {
      title: '7. Sicherheit',
      paragraphs: [
        'Wir verwenden administrative, technische und organisatorische Maßnahmen zum Schutz von Informationen. Keine Übermittlungs- oder Speichermethode ist zu 100 % sicher; wir können absolute Sicherheit nicht garantieren.',
      ],
    },
    {
      title: '8. Ihre Rechte und Wahlmöglichkeiten',
      paragraphs: [
        'Je nach Ihrem Standort haben Sie möglicherweise das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung oder Übertragung Ihrer personenbezogenen Daten sowie Widerspruch gegen eine bestimmte Verarbeitung. Sie können Profileinstellungen in der App aktualisieren und Cookie-Präferenzen über unser Cookie-Banner verwalten.',
        'Um Ihre Datenschutzrechte auszuüben, kontaktieren Sie legal@tscopier.ai. Wir können Ihre Identität vor der Beantwortung überprüfen. Sie können auch eine Beschwerde bei Ihrer örtlichen Datenschutzbehörde einreichen.',
      ],
    },
    {
      title: '9. Kinder',
      paragraphs: [
        'Der Dienst richtet sich nicht an Kinder unter 18 Jahren. Wir erheben wissentlich keine personenbezogenen Daten von Kindern. Kontaktieren Sie uns, wenn Sie der Meinung sind, dass ein Kind Daten übermittelt hat, und wir werden diese löschen.',
      ],
    },
    {
      title: '10. Änderungen',
      paragraphs: [
        'Wir können diese Datenschutzerklärung von Zeit zu Zeit aktualisieren. Wir veröffentlichen die überarbeitete Fassung mit einem neuen Datum der „Zuletzt aktualisiert“ und stellen, soweit erforderlich, einen zusätzlichen Hinweis bereit.',
      ],
    },
  ],
  closing:
    'Für Fragen oder Anfragen zum Datenschutz kontaktieren Sie legal@tscopier.ai.',
  contact: legalContactDe,
}
