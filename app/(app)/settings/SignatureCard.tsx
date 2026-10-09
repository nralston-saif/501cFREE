'use client'

import { useActionState, useTransition } from 'react'
import { removeSignatureAction, uploadSignatureAction } from '@/lib/actions/settings'

interface SignatureCardProps {
  /** Short-lived signed URL of the current signature, or null if none */
  signatureUrl: string | null
}

export default function SignatureCard({ signatureUrl }: SignatureCardProps) {
  const [state, upload, uploading] = useActionState(uploadSignatureAction, { error: null, ok: false })
  const [removing, startRemove] = useTransition()

  return (
    <div className="card p-6">
      <h2 className="font-medium text-gray-900 mb-1">Letter signature</h2>
      <p className="text-xs text-gray-400 mb-4">
        Printed above the signatory&apos;s name on acknowledgement letters. PNG or JPEG, up to 1 MB; a
        transparent PNG looks best. Without one, letters leave space for a handwritten signature.
      </p>

      {signatureUrl ? (
        <div className="mb-4 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, not optimizable */}
          <img
            src={signatureUrl}
            alt="Current signature"
            className="h-16 max-w-xs object-contain rounded border border-gray-200 bg-white p-2"
          />
          <button
            type="button"
            className="btn btn-secondary text-sm"
            disabled={removing}
            onClick={() => startRemove(async () => void (await removeSignatureAction()))}
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      ) : null}

      <form action={upload} className="flex flex-wrap items-center gap-3">
        <label htmlFor="signature-file" className="sr-only">
          Signature image
        </label>
        <input
          id="signature-file"
          name="signature"
          type="file"
          accept="image/png,image/jpeg"
          required
          className="text-sm"
        />
        <button type="submit" className="btn btn-primary text-sm" disabled={uploading}>
          {uploading ? 'Uploading…' : signatureUrl ? 'Replace signature' : 'Upload signature'}
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  )
}
