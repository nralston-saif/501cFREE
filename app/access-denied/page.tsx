import { APP_NAME } from '@/lib/branding'
import { withBasePath } from '@/lib/basePath'

export default function AccessDeniedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5] px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 max-w-md text-center">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-500 text-sm">
          Your account doesn&rsquo;t have access to {APP_NAME}, or it has been deactivated. Ask
          an admin on your team if you believe this is a mistake.
        </p>
        {/* Plain <a>: the sign-out route handler needs a full request */}
        <a
          href={withBasePath('/auth/signout')}
          className="inline-block mt-6 text-sm text-gray-500 hover:text-gray-900 underline decoration-gray-300"
        >
          Sign in with a different account
        </a>
      </div>
    </div>
  )
}
