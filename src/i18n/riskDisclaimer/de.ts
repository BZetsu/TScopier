import type { RiskDisclaimerPageTranslations } from './types'

export const riskDisclaimerDe: RiskDisclaimerPageTranslations = {
  title: 'Risikohinweis',
  intro:
    'Der Handel mit Devisen, CFDs und anderen gehebelten Produkten birgt ein erhebliches Verlustrisiko. UniCopier ist ein Werkzeug zum Kopieren von Trades — kein Broker, Anlageberater oder Finanzplaner. Nichts auf dieser Seite stellt eine Finanzberatung dar. Sie sind allein verantwortlich für Ihre Handelsentscheidungen und alle Verluste.',
  sections: [
    {
      title: 'Allgemeines Handelsrisiko',
      paragraphs: [
        'Sie können einen Teil oder die gesamte eingezahlte Einlage verlieren. Der Hebel vergrößert sowohl Gewinne als auch Verluste. Die vergangene Performance eines Signal-Providers, ein Backtest oder Ihre eigene Historie garantieren keine zukünftigen Ergebnisse.',
        'Märkte können bei Nachrichtenereignissen Lücken bilden, den Handel aussetzen oder sich heftig bewegen. UniCopier garantiert nicht, dass Signale zu einem bestimmten Preis oder zu einer bestimmten Zeit empfangen, verarbeitet oder ausgeführt werden.',
      ],
    },
    {
      title: 'Risiko des Signal-Providers',
      paragraphs: [
        'Kopieren Sie nur Signal-Provider, denen Sie vertrauen und die Sie verstehen. Provider haben möglicherweise Anreize, die Ihren Interessen widersprechen. Marketing-Screenshots, behauptete Trefferquoten und ausgewählte Ergebnisse spiegeln möglicherweise nicht wider, was Sie auf Ihrem Konto, mit Ihrer Losgröße, Ihrem Broker oder Ihrer Latenz tatsächlich erleben werden.',
        'Prüfen Sie die Performance nach Möglichkeit unabhängig. Ein Provider, der für andere funktioniert, kann für Ihre Risikotoleranz, Kontogröße oder Handelszeiten dennoch ungeeignet sein.',
      ],
    },
    {
      title: 'Repainting und Kanaltäuschung',
      paragraphs: [
        'Einige Telegram-Signalkanäle bearbeiten oder löschen Nachrichten, nachdem ein Trade schiefgeht, damit der öffentliche Feed makellos wirkt. Ein „erfolgreicher“ Aufruf wurde möglicherweise überarbeitet; ein Verlust-Aufruf kann vollständig verschwinden.',
        'Verlassen Sie sich nicht nur auf die sichtbare Historie eines Kanals oder auf Screenshots von Dritten. Vergleichen Sie mit Ihren eigenen Copier Logs, Broker-Auszügen und zeitgestempelten Aufzeichnungen. Repainting macht es Provider leicht, genauer zu wirken, als sie tatsächlich sind.',
      ],
    },
    {
      title: 'Grenzen bei Parsing und Ausführung',
      paragraphs: [
        'Signale werden automatisch aus Text interpretiert. Tippfehler bei Stop-Loss (SL) oder Take-Profit (TP) — falsche Ziffern, fehlende Dezimalstellen, mehrdeutige Symbole oder gemischte Einheiten — können zu ungültigen Preisen führen. UniCopier kann das Signal überspringen, ungültige Niveaus ignorieren oder Standardwerte aus Ihrer Konfiguration anwenden, anstatt die Absicht des Providers umzusetzen.',
        'Die Ausführung kann von der Einstiegsorder des Providers abweichen: Slippage, Requotes, Teilausführungen, Mindestabstandsregeln und Sitzungstrennungen beim Broker beeinflussen das Ergebnis. Strikte Einstiege, Range-Pending-Orders und Multi-Leg-Stile erhöhen die Komplexität. Prüfen Sie immer Ihre offenen Positionen bei Ihrem Broker.',
      ],
    },
    {
      title: 'Operative und Konfigurationsrisiken',
      paragraphs: [
        'News-Blackouts, Kanalfilter, Gewinnziele, maximale Verlustgrenzen, Abonnementstatus und Einstellungen pro Kanal können das Kopieren blockieren oder verändern. Falsch konfigurierte Losgröße, Symbol-Zuordnungen oder nicht verknüpfte Kanäle sind häufige Gründe, warum Trades nicht wie erwartet kopiert werden.',
        'Das automatische Glattstellen bei Erreichen der Grenzen schließt kanalzugehörige Trades auf UniCopier-Seite, kann aber bereits entstandene Marktverluste nicht rückgängig machen. Konfigurationsänderungen werden erst nach dem Speichern wirksam — ungespeicherte Entwürfe schützen Ihr Konto nicht.',
      ],
    },
    {
      title: 'Beteiligt bleiben beim Kopieren',
      paragraphs: [
        'Automatisches Kopieren ist kein „Einrichten und vergessen“. Überwachen Sie regelmäßig offene Trades, Equity, Margin und Copier Logs. Greifen Sie bei Ihrem Broker ein, wenn sich die Bedingungen ändern oder Sie nicht mehr mit der Risikobelastung eines Providers einverstanden sind.',
        'Wenn Sie Ihr Konto nicht aktiv überwachen können, ist das Kopieren von Live-Signalen möglicherweise nicht für Sie geeignet.',
      ],
    },
    {
      title: 'Ihre Chancen verbessern (keine Beratung)',
      paragraphs: [
        'Beginnen Sie mit einem Demo-Konto oder der kleinsten Live-Größe, die Sie sich leisten können zu verlieren. Prüfen Sie Kanäle über die Zeit hinweg; verwenden Sie verfügbare Backtests; aktivieren Sie maximale Verlustgrenzen und Gewinnziele; passen Sie Kanalfilter an; diversifizieren Sie über mehrere Provider, statt das Risiko zu konzentrieren.',
        'Lesen Sie die Übersprunggründe in den Copier Logs, wenn Signale nicht gehandelt werden. Bleiben Sie realistisch — konstante kleine Vorteile mit strikter Risikokontrolle sind etwas völlig anderes als „Schnell reich werden“-Marketing.',
      ],
    },
  ],
  closing:
    'Mit der Nutzung von UniCopier erkennen Sie an, dass Handel riskant ist, dass Signal-Provider unzuverlässig oder irreführend sein können und dass Sie die volle Verantwortung für alle Trades übernehmen, die auf Ihren verknüpften Konten platziert werden.',
}
