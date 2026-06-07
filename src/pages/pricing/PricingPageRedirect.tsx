import { Navigate } from 'react-router-dom'

/** Legacy /pricing route — redirects to billing plans. */
export function PricingPageRedirect() {
  return <Navigate to="/billing#subscription-plans" replace />
}
