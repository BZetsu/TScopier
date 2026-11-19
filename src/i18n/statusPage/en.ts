import type { StatusPageTranslations } from './types'

export const statusPageEn: StatusPageTranslations = {
  brand: 'UniCopier',
  title: 'System status',
  subtitle: 'Live health of UniCopier platform services.',
  updated: 'Updated {time}',
  refreshing: 'Refreshing…',
  refresh: 'Refresh',
  loadError: 'Could not load system status. Try again in a moment.',
  retry: 'Retry',
  overall: {
    operational: 'All systems operational',
    degraded: 'Partial disruption',
    outage: 'Major disruption',
  },
  componentStatus: {
    operational: 'Operational',
    degraded: 'Degraded',
    outage: 'Outage',
    unknown: 'Unknown',
  },
  componentsHeading: 'Services',
  incidentsHeading: 'Active incidents',
  noIncidents: 'No active incidents.',
  incidentActive: 'Active',
  impactMajor: 'Major',
  impactMinor: 'Minor',
  contactSupport: 'Contact support',
  backHome: 'Back to app',
}
