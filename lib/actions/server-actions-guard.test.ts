import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import ts from 'typescript'

// Guard for the server-action error contract (see ./result.ts): Next.js hides
// the message of anything thrown out of a server action in production, so an
// exported action must not let a throw escape. A throw (or a call to a
// throwing helper like requireMemberId) is allowed only inside a
// runAction(...)/asState(...) callback or a try block.

const ACTIONS_DIR = path.resolve(__dirname)
const THROWING_HELPERS = new Set(['requireMemberId', 'requireAdminId', 'requiredString'])
const WRAPPERS = new Set(['runAction', 'asState'])

function isGuarded(node: ts.Node, fnBody: ts.Node): boolean {
  let child = node
  for (let parent = node.parent; parent && child !== fnBody; child = parent, parent = parent.parent) {
    if (ts.isTryStatement(parent) && child === parent.tryBlock) return true
    if (
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      WRAPPERS.has(parent.expression.text) &&
      parent.arguments.includes(child as ts.Expression)
    ) {
      return true
    }
  }
  return false
}

function unguardedThrows(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8')
  if (!/^['"]use server['"]/.test(src)) return []
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
  const problems: string[] = []
  for (const st of sf.statements) {
    if (!ts.isFunctionDeclaration(st) || !st.body || !st.name) continue
    if (!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    const body = st.body
    const visit = (node: ts.Node) => {
      const throwing =
        ts.isThrowStatement(node) ||
        (ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          THROWING_HELPERS.has(node.expression.text))
      if (throwing && !isGuarded(node, body)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        problems.push(`${path.basename(file)}:${line + 1} ${st.name!.text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(body)
  }
  return problems
}

describe('server actions', () => {
  it('never let a throw escape an exported action', () => {
    const files = fs
      .readdirSync(ACTIONS_DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => path.join(ACTIONS_DIR, f))
    expect(files.length).toBeGreaterThan(10)
    expect(files.flatMap(unguardedThrows)).toEqual([])
  })
})
