import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "@typescript/typescript6"

const ROOT = join(__dirname, "..", "..", "..")

const SETTINGS_ONLY: Array<[string, string]> = [
  ["lib/actions/connections.ts", "sendConnectionInvite"],
  ["lib/actions/connections.ts", "acceptConnection"],
  ["lib/actions/connections.ts", "rejectConnection"],
  ["lib/actions/connections.ts", "removeConnection"],
  ["lib/actions/connection-mode.ts", "setConnectionMode"],
  ["lib/actions/connection-mode.ts", "setVendorOperatingMode"],
  ["lib/actions/connection-mode.ts", "setConnectionAutoActivate"],
  ["lib/actions/vendor-aliases.ts", "addVendorAlias"],
  ["lib/actions/vendor-aliases.ts", "removeVendorAlias"],
  ["lib/actions/vendor-divisions.ts", "setVendorDivisions"],
  ["lib/actions/categories/merge.ts", "mergeCategories"],
  ["lib/actions/vendor-renewals/alert-settings.ts", "saveVendorRenewalAlertSettings"],
]

function gatesIn(file: string, fnName: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true)
  const fn = sf.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fnName,
  )
  if (!fn?.body) throw new Error(`${file}#${fnName} not found`)
  const gates: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text
      if (name === "requireCanMutate") gates.push(name)
      if (name === "requireCan") {
        const arg = node.arguments[0]
        gates.push(`requireCan(${arg && ts.isStringLiteral(arg) ? arg.text : "?"})`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(fn.body)
  return gates
}

describe("Settings-tab writes are Super-only", () => {
  it.each(SETTINGS_ONLY)("%s#%s requires settings.manage", (file, fnName) => {
    expect(gatesIn(file, fnName)).toContain("requireCan(settings.manage)")
  })
})
