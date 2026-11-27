import type { StatusPageTranslations } from './types'

export const statusPageDe: StatusPageTranslations = {
  brand: 'UniCopier',
  title: 'Systemstatus',
  subtitle: 'Aktuelle Verfügbarkeit der UniCopier-Plattformdienste.',
  updated: 'Aktualisiert {time}',
  refreshing: 'Wird aktualisiert…',
  refresh: 'Aktualisieren',
  loadError: 'Der Systemstatus konnte nicht geladen werden. Versuchen Sie es gleich noch einmal.',
  retry: 'Erneut versuchen',
  overall: {
    operational: 'Alle Systeme betriebsbereit',
    degraded: 'Teilweise Störung',
    outage: 'Schwerwiegende Störung',
  },
  componentStatus: {
    operational: 'Betriebsbereit',
    degraded: 'Eingeschränkt',
    outage: 'Ausfall',
    unknown: 'Unbekannt',
  },
  componentsHeading: 'Dienste',
  incidentsHeading: 'Aktive Vorfälle',
  noIncidents: 'Keine aktiven Vorfälle.',
  incidentActive: 'Aktiv',
  impactMajor: 'Schwerwiegend',
  impactMinor: 'Gering',
  contactSupport: 'Support kontaktieren',
  backHome: 'Zurück zur App',
}
