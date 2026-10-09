import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import SubmitButton from '@/components/SubmitButton'
import { upsertCategory } from '@/lib/actions/expenses'
import CategoryRowActions from './CategoryRowActions'
import {
  FUNCTIONAL_CLASS_BADGES,
  FUNCTIONAL_CLASS_LABELS,
  FUNCTIONAL_CLASS_ORDER,
} from '../functional-class'
import ActionForm from '@/components/ActionForm'

export default async function ExpenseCategoriesPage() {
  const supabase = await createClient()

  const { data: categories } = await supabase
    .from('expense_categories')
    .select('*')
    .order('name')

  const allCategories = categories ?? []

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Expense categories"
        description="Categories map expenses to Form 990 functional classes and lines."
      >
        <Link href="/expenses" className="btn btn-secondary">
          Back to expenses
        </Link>
      </PageHeader>

      <div className="space-y-6">
        {allCategories.length === 0 ? (
          <EmptyState message="No categories yet. Add one below." />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Functional class</th>
                  <th className="px-4 py-3 font-medium">990 line</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {allCategories.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${FUNCTIONAL_CLASS_BADGES[c.functional_class]}`}
                      >
                        {FUNCTIONAL_CLASS_LABELS[c.functional_class]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{c.form_990_line ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {c.is_active ? 'Active' : 'Inactive'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <CategoryRowActions categoryId={c.id} isActive={c.is_active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ActionForm action={upsertCategory} className="card p-6">
          <h3 className="font-medium text-gray-900 mb-4">Add category</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input id="name" type="text" name="name" required className="input" />
            </div>
            <div>
              <label
                htmlFor="functional_class"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Functional class
              </label>
              <select
                id="functional_class"
                name="functional_class"
                required
                defaultValue=""
                className="input"
              >
                <option value="" disabled>
                  Select a class…
                </option>
                {FUNCTIONAL_CLASS_ORDER.map((fc) => (
                  <option key={fc} value={fc}>
                    {FUNCTIONAL_CLASS_LABELS[fc]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="form_990_line"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                990 line
              </label>
              <input
                id="form_990_line"
                type="text"
                name="form_990_line"
                placeholder="e.g. 24a"
                className="input"
              />
            </div>
          </div>
          <div className="flex justify-end mt-6">
            <SubmitButton>Add category</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </div>
  )
}
