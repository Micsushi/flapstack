import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const sourceRoot = join(process.cwd(), "src", "main")
const intentionallyVisibleModules = new Set([join(sourceRoot, "lib", "external", "app-launch.ts")])
const childProcessFunctions = new Set([
  "exec",
  "execFile",
  "execFileSync",
  "execSync",
  "spawn",
  "spawnSync",
])

function typescriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return typescriptFiles(path)
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : []
  })
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return null
}

function hidesWindows(
  expression: ts.Expression,
  objectVariables: ReadonlyMap<string, ts.ObjectLiteralExpression>,
): boolean {
  const object = ts.isObjectLiteralExpression(expression)
    ? expression
    : ts.isIdentifier(expression)
      ? objectVariables.get(expression.text)
      : undefined
  if (!object) return false

  return object.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === "windowsHide" &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  )
}

function visibilityFailures(path: string): string[] {
  if (intentionallyVisibleModules.has(path)) return []

  const source = readFileSync(path, "utf8")
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const trackedCalls = new Set<string>()
  const objectVariables = new Map<string, ts.ObjectLiteralExpression>()

  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "node:child_process" &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.isTypeOnly) continue
        const importedName = element.propertyName?.text ?? element.name.text
        if (childProcessFunctions.has(importedName)) trackedCalls.add(element.name.text)
      }
    }

    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      if (ts.isObjectLiteralExpression(declaration.initializer)) {
        objectVariables.set(declaration.name.text, declaration.initializer)
      }
      if (
        ts.isCallExpression(declaration.initializer) &&
        ts.isIdentifier(declaration.initializer.expression) &&
        declaration.initializer.expression.text === "promisify" &&
        declaration.initializer.arguments.length === 1 &&
        ts.isIdentifier(declaration.initializer.arguments[0]) &&
        trackedCalls.has(declaration.initializer.arguments[0].text)
      ) {
        trackedCalls.add(declaration.name.text)
      }
    }
  }

  const failures: string[] = []
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      trackedCalls.has(node.expression.text) &&
      !node.arguments.some((argument) => hidesWindows(argument, objectVariables))
    ) {
      const position = file.getLineAndCharacterOfPosition(node.getStart(file))
      failures.push(
        `${relative(process.cwd(), path)}:${position.line + 1} ${node.expression.text}()`,
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return failures
}

describe("Windows background child processes", () => {
  it("explicitly suppresses console windows in the Electron main process", () => {
    const failures = typescriptFiles(sourceRoot).flatMap(visibilityFailures)
    expect(failures, failures.join("\n")).toEqual([])
  })
})
