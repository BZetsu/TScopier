import type { StatusPageTranslations } from './types'

export const statusPageFr: StatusPageTranslations = {
  brand: 'UniCopier',
  title: 'État du système',
  subtitle: 'Santé en direct des services de la plateforme UniCopier.',
  updated: 'Mis à jour {time}',
  refreshing: 'Actualisation…',
  refresh: 'Actualiser',
  loadError: 'Impossible de charger l’état du système. Réessayez dans un instant.',
  retry: 'Réessayer',
  overall: {
    operational: 'Tous les systèmes opérationnels',
    degraded: 'Perturbation partielle',
    outage: 'Perturbation majeure',
  },
  componentStatus: {
    operational: 'Opérationnel',
    degraded: 'Dégradé',
    outage: 'Panne',
    unknown: 'Inconnu',
  },
  componentsHeading: 'Services',
  incidentsHeading: 'Incidents actifs',
  noIncidents: 'Aucun incident actif.',
  incidentActive: 'Actif',
  impactMajor: 'Majeur',
  impactMinor: 'Mineur',
  contactSupport: 'Contacter le support',
  backHome: 'Retour à l’app',
}
