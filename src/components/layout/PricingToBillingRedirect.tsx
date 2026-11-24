import { Navigate, useLocation } from 'react-router-dom'

/** Legacy authenticated `/pricing` → plans on Billing. */
export function PricingToBillingRedirect() {
  const location = useLocation()
  return <Navigate to={`/billing${location.search}`} replace />
}
