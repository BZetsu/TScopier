import { Construction } from 'lucide-react'

interface PlaceholderPageProps {
  title: string
  description: string
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">{title}</h1>
        <p className="text-sm text-neutral-500 mt-0.5">{description}</p>
      </div>
      <div className="bg-white rounded-xl border border-dashed border-neutral-200 py-20 text-center">
        <Construction className="w-10 h-10 mx-auto mb-3 text-neutral-300" />
        <p className="text-sm font-medium text-neutral-500">Coming soon</p>
        <p className="text-xs text-neutral-300 mt-1">This feature is under development</p>
      </div>
    </div>
  )
}
