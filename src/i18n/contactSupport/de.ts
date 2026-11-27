import type { ContactSupportPageTranslations } from './types'

export const contactSupportDe: ContactSupportPageTranslations = {
  channelsTitle: 'Wie können wir helfen?',
  channelsSubtitle:
    'Kontaktieren Sie das UniCopier-Team per E-Mail, lesen Sie die Dokumentation oder öffnen Sie den Support-Chat in der App.',
  systemStatus: {
    title: 'Systemstatus',
    description: 'Prüfen Sie, ob die Dienste der UniCopier-Plattform gerade verfügbar sind.',
    cta: 'Status ansehen',
  },
  email: {
    title: 'E-Mail-Support',
    description:
      'Fragen zu Konto, Abrechnung oder Copier — wir antworten in der Regel innerhalb eines Werktags.',
    cta: 'E-Mail senden',
  },
  docs: {
    title: 'Dokumentation',
    description:
      'Schritt-für-Schritt-Anleitungen zum Verknüpfen von Brokern, Telegram-Kanalen, Handelsstilen und zur Fehlerbehebung.',
    cta: 'Dokumentation öffnen',
  },
  liveChat: {
    title: 'Support-Chat',
    description:
      'Schreiben Sie unserem KI-Assistenten oder fordern Sie einen menschlichen Agenten an — für schnelle Hilfe bei der Einrichtung im Dashboard.',
    cta: 'Support-Chat öffnen',
  },
  faq: {
    title: 'Häufig gestellte Fragen',
    subtitle: 'Schnelle Antworten, bevor Sie Kontakt aufnehmen.',
    items: [
      {
        question: 'Wie verbinde ich mein MetaTrader-Konto?',
        answer:
          'Öffnen Sie Konfiguration, fügen Sie ein Broker-Konto hinzu, geben Sie Ihre MetaTrader-Zugangsdaten ein und warten Sie, bis der Verbindungsstatus „Verbunden“ anzeigt. Jedes verknüpfte Konto braucht gespeicherte Handelsstil-, Losgrößen- und Kanalauswahl-Einstellungen, bevor das Kopieren beginnt.',
      },
      {
        question: 'Warum werden meine Telegram-Signale nicht kopiert?',
        answer:
          'Prüfen Sie, ob Ihr Broker verbunden ist, der Telegram-Kanal verknüpft und aktiv ist, der Kanal in der Konfiguration dem Broker zugeordnet ist, Ihr Abonnement aktiv ist und Ihre E-Mail verifiziert ist. Prüfen Sie die Copier Logs nach Übersprunggründen wie Kanalfiltern, News-Blackout oder fehlendem SL/TP im Signal.',
      },
      {
        question: 'Wie füge ich einen Telegram-Signalkanal hinzu?',
        answer:
          'Gehen Sie zu Kanäle, verbinden Sie Telegram falls nötig und fügen Sie den Kanal-Benutzernamen oder den Einladungslink hinzu. Aktivieren Sie den Kanal und ordnen Sie ihn in der Konfiguration den Broker-Konten zu, die seine Signale kopieren sollen.',
      },
      {
        question: 'Was bewirkt der News-Handel / der Blackout des Wirtschaftskalenders?',
        answer:
          'Wenn News-Handel für ein Konto deaktiviert ist, kann UniCopier neue Einstiege pausieren und optional offene Trades um Ereignisse mit hoher Marktwirkung schließen. Verwenden Sie die Seite Wirtschaftskalender, um anstehende Veröffentlichungen einzusehen, und konfigurieren Sie Regeln unter Kontokonfiguration.',
      },
      {
        question: 'Brauche ich ein kostenpflichtiges Abonnement, um Trades zu kopieren?',
        answer:
          'Für die Live-Ausführung des Telegram-Copiers ist ein aktiver kostenpflichtiger Plan erforderlich. Wählen Sie auf der Preisseite einen Plan, um die App freizuschalten. Prüfen Sie unter Abrechnung Ihren aktuellen Plan und den Verlängerungsstatus.',
      },
      {
        question: 'Warum muss ich meine E-Mail verifizieren, bevor ich die Plattform nutze?',
        answer:
          'Die E-Mail-Verifizierung bestätigt Ihre Anmeldung und ermöglicht es uns, Abrechnungsbelege und wichtige Kontowarnungen zu senden. Wenn Sie am Verifizierungsbildschirm hängen, verwenden Sie den Link zum erneuten Senden oder kontaktieren Sie den Support mit der Adresse, mit der Sie sich angemeldet haben.',
      },
      {
        question: 'Mein Broker zeigt getrennt — was kann ich tun?',
        answer:
          'Bestätigen Sie, dass MetaTrader auf der Broker-Seite läuft, die Zugangsdaten noch gültig sind und das Konto nicht gesperrt ist. Aktualisieren Sie die Verbindung über die Konfiguration und prüfen Sie die Copier Logs auf Sitzungsfehler. Falls das Problem weiterhin besteht, schreiben Sie dem Support mit Broker-Namen und Konto-Login (niemals Ihr Passwort).',
      },
      {
        question: 'Kann ich denselben Kanal auf mehrere Broker kopieren?',
        answer:
          'Ja. Verknüpfen Sie jedes MetaTrader-Konto separat in der Konfiguration und wählen Sie auf jedem Broker denselben Telegram-Kanal. Losgröße, Handelsstil und Risikoeinstellungen gelten pro Konto.',
      },
    ],
  },
}
