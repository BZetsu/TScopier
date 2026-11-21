import type { StatusPageTranslations } from './types'

export const statusPageEs: StatusPageTranslations = {
  brand: 'UniCopier',
  title: 'Estado del sistema',
  subtitle: 'Salud en vivo de los servicios de la plataforma UniCopier.',
  updated: 'Actualizado {time}',
  refreshing: 'Actualizando…',
  refresh: 'Actualizar',
  loadError: 'No se pudo cargar el estado del sistema. Inténtalo de nuevo en un momento.',
  retry: 'Reintentar',
  overall: {
    operational: 'Todos los sistemas operativos',
    degraded: 'Interrupción parcial',
    outage: 'Interrupción mayor',
  },
  componentStatus: {
    operational: 'Operativo',
    degraded: 'Degradado',
    outage: 'Caída',
    unknown: 'Desconocido',
  },
  componentsHeading: 'Servicios',
  incidentsHeading: 'Incidentes activos',
  noIncidents: 'No hay incidentes activos.',
  incidentActive: 'Activo',
  impactMajor: 'Mayor',
  impactMinor: 'Menor',
  contactSupport: 'Contactar soporte',
  backHome: 'Volver a la app',
}
