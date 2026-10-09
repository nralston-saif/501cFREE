import Link from 'next/link'
import { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  action?: { href: string; label: string }
  children?: ReactNode
}

export default function PageHeader({ title, description, action, children }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        {description && <p className="text-gray-500 mt-1 text-sm">{description}</p>}
      </div>
      <div className="flex items-center gap-3">
        {children}
        {action && (
          <Link href={action.href} className="btn btn-primary">
            {action.label}
          </Link>
        )}
      </div>
    </div>
  )
}
