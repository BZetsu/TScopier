import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { authRedirectUrl } from '../../lib/authRedirect'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { AuthBackHome } from '../../components/auth/AuthBackHome'
import { useLocale } from '../../context/LocaleContext'

export function ForgotPasswordPage() {
  const { auth } = useLocale()
  const t = auth.forgotPassword

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: authRedirectUrl('/reset-password'),
    })

    setSent(true)
    setLoading(false)
  }

  if (sent) {
    const subtitle = t.sentSubtitle.replace('{email}', email.trim())

    return (
      <div className="w-full">
        <AuthBackHome />
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-900/20">
            <Mail className="h-8 w-8 text-teal-600 dark:text-teal-400" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
            {t.sentHeading}
          </h1>
          <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{t.sentHint}</p>
          <Link
            to="/login"
            className="mt-8 inline-block text-sm font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
          >
            {t.backToLogin}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <AuthBackHome />
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-3xl">
        {t.heading}
      </h1>
      <p className="mt-2 mb-8 text-sm text-neutral-500 dark:text-neutral-400">{t.subtitle}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t.email}
          type="email"
          placeholder={t.emailPlaceholder}
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="py-2.5"
        />

        <Button type="submit" loading={loading} className="w-full !mt-6" size="lg">
          {t.submit}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
        <Link
          to="/login"
          className="font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
        >
          {t.backToLogin}
        </Link>
      </p>
    </div>
  )
}
