import type { ReactNode } from 'react'
import { APP_NAME } from '@/lib/branding'

// Centered card shared by the signed-out screens (login, link confirmation,
// set password, access denied).
export default function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-semibold tracking-tight text-[#1a1a1a]">{APP_NAME}</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="text-gray-500 mt-1">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
