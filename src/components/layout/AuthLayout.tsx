import { Outlet } from 'react-router-dom'
import tscopierLogo from '/tscopierlogo.png'

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <img src={tscopierLogo} alt="TSCopier" className="h-10 w-auto" />
        </div>

        <Outlet />

        <p className="text-center text-white/40 text-xs mt-6">
          One seamless copier for every Telegram signal
        </p>
      </div>
    </div>
  )
}
