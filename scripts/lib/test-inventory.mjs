import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import ts from "typescript"

const caseNames = new Set(["it", "test", "specify"])
const readNames = new Set(["readFile", "readFileSync"])
const pathBuilders = new Set(["join", "resolve", "URL", "fileURLToPath"])
const sourcePath = /(?:^|[/\\])src(?:[/\\]|$)/

function visit(node, inspect) {
  inspect(node)
  ts.forEachChild(node, (child) => visit(child, inspect))
}

function nameOf(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return ""
}

function isCase(call) {
  let expression = call.expression
  // Count the registration after supplying an each table or applying a condition.
  if (["each", "for", "skipIf", "runIf", "extend"].includes(nameOf(expression))) return false
  if (ts.isCallExpression(expression)) expression = expression.expression
  if (ts.isTaggedTemplateExpression(expression)) expression = expression.tag
  while (ts.isPropertyAccessExpression(expression)) {
    if (expression.name.text === "test" && expression.expression.getText() === "t") return true
    expression = expression.expression
  }
  return ts.isIdentifier(expression) && caseNames.has(expression.text)
}

function inspectTest(test) {
  const source = ts.createSourceFile(test, readFileSync(test, "utf8"), ts.ScriptTarget.Latest, true)
  const readers = new Set(readNames)
  const bindings = new Map()
  const calls = []
  visit(source, (node) => {
    if (ts.isCallExpression(node)) calls.push(node)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer)
    }
    if (
      ts.isImportDeclaration(node) &&
      /^(?:node:)?fs(?:\/promises)?$/.test(node.moduleSpecifier.text)
    ) {
      const imports = node.importClause?.namedBindings
      if (imports && ts.isNamedImports(imports)) {
        for (const item of imports.elements) {
          if (readNames.has((item.propertyName ?? item.name).text)) readers.add(item.name.text)
        }
      }
    }
  })

  // Include local read helpers such as readSource(file) alongside direct fs calls.
  visit(source, (node) => {
    const fn = ts.isFunctionDeclaration(node)
      ? node
      : ts.isVariableDeclaration(node) &&
          node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ? node.initializer
        : undefined
    if (!fn?.body || !node.name || !ts.isIdentifier(node.name)) return
    const helper = node.name.text
    visit(fn.body, (child) => {
      if (ts.isCallExpression(child) && readers.has(nameOf(child.expression))) readers.add(helper)
    })
  })

  function refersToSource(expression, seen = new Set()) {
    if (ts.isStringLiteralLike(expression)) return sourcePath.test(expression.text)
    if (ts.isTemplateExpression(expression)) {
      return (
        sourcePath.test(expression.head.text) ||
        expression.templateSpans.some(
          ({ expression, literal }) =>
            sourcePath.test(literal.text) || refersToSource(expression, seen),
        )
      )
    }
    if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
      return (
        pathBuilders.has(nameOf(expression.expression)) &&
        expression.arguments?.some((argument) => refersToSource(argument, seen))
      )
    }
    if (ts.isPropertyAccessExpression(expression)) return false
    if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
      const initializer = bindings.get(expression.text)
      if (initializer) {
        seen.add(expression.text)
        return refersToSource(initializer, seen)
      }
    }
    return Boolean(ts.forEachChild(expression, (child) => refersToSource(child, seen) || undefined))
  }

  return {
    definitions: calls.filter(isCase).length,
    readsSource: calls.some(
      (call) =>
        readers.has(nameOf(call.expression)) &&
        call.arguments[0] &&
        refersToSource(call.arguments[0]),
    ),
  }
}

export function testInventory(root) {
  const tests = path.join(root, "tests")
  const files = readdirSync(tests, { recursive: true, withFileTypes: true }).filter(
    (entry) => entry.isFile() && /\.test\.(?:tsx?|[mc]?js)$/.test(entry.name),
  )
  const sourceReaders = []
  let definitions = 0
  for (const entry of files) {
    const file = path.join(entry.parentPath, entry.name)
    const result = inspectTest(file)
    definitions += result.definitions
    if (result.readsSource) sourceReaders.push(path.relative(root, file).replaceAll("\\", "/"))
  }
  return { files: files.length, definitions, sourceReaders: sourceReaders.sort() }
}

export function reportTestInventory(root, reports) {
  const { files, definitions, sourceReaders } = testInventory(root)
  const sourceLines = readdirSync(path.join(root, "src"), { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(?:[cm]?[jt]sx?|css|html)$/.test(entry.name) &&
        !/\.(?:test|spec)\.|\.d\.[cm]?ts$/.test(entry.name),
    )
    .reduce((total, entry) => {
      const source = readFileSync(path.join(entry.parentPath, entry.name), "utf8")
      return total + (source ? source.replace(/\r?\n$/, "").split(/\r?\n/).length : 0)
    }, 0)
  const density = sourceLines ? ((definitions * 10_000) / sourceLines).toFixed(2) : "unavailable"
  const vitestCases =
    reports.length && reports.every(existsSync)
      ? reports.reduce(
          (total, file) => total + JSON.parse(readFileSync(file, "utf8")).numTotalTests,
          0,
        )
      : null
  console.log(
    `[tests] permanent inventory: ${files} files, ${definitions} static case definitions, Vitest cases: ${vitestCases ?? "unavailable"}, ${density} static cases per 10k production lines in src/`,
  )
  if (sourceReaders.length > 0) {
    console.warn("[tests] possible direct src/ text reads:", sourceReaders.join(", "))
  }
}
