import path from 'node:path'
import ts from 'typescript'

function moduleReferences(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest)
  const eager = new Set()
  const lazy = new Set()
  const types = new Set()
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) eager.add(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) lazy.add(node.arguments[0].text)
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') eager.add(node.arguments[0].text)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      types.add(node.argument.literal.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { eager, lazy, types }
}

function resolveSpecifier(importer, specifier) {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`
  if (specifier.startsWith('.')) return path.posix.join(path.posix.dirname(importer), specifier)
  return specifier
}

const withoutExtension = value => value.replace(/\.(?:ts|tsx|mjs|js)$/, '')

function matchesTarget(file, target, within) {
  const normalized = withoutExtension(target)
  const directory = normalized.replace(/\/index$/, '')
  const resolved = withoutExtension(file)
  return resolved === normalized || resolved === directory || resolved === `${normalized}/index` ||
    (within && directory === normalized && resolved.startsWith(`${directory}/`))
}

function importsMatching(source, importer, target, within) {
  const { eager, lazy, types } = moduleReferences(source, importer)
  for (const specifier of [...eager, ...lazy, ...types]) {
    const resolved = resolveSpecifier(importer, specifier)
    if (matchesTarget(resolved, target, within)) return true
  }
  return false
}

export function importsTarget(source, importer, target) {
  return importsMatching(source, importer, target, false)
}

export function importsWithinTarget(source, importer, target) {
  return importsMatching(source, importer, target, true)
}

/** 解析编译后仍存在的模块边，运行时依赖与类型引用分别处理。 */
export function desktopDependencyGraph(sources, root) {
  const modules = sources.filter(file => /^(src|electron)\/.*\.[jt]sx?$/.test(file.path) && !file.path.endsWith('.d.ts'))
  const paths = new Set(modules.map(file => file.path))
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const { options, errors } = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, root)
  if (errors.length) throw new Error(ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'))
  const cache = ts.createModuleResolutionCache(root, file => file, options)
  const graph = {}
  for (const file of modules) {
    const emitted = ts.transpileModule(file.source, { fileName: file.path, compilerOptions: options })
    const { eager, lazy } = moduleReferences(emitted.outputText, 'output.js')
    function localPaths(specifiers) {
      const dependencies = new Set()
      for (const specifier of specifiers) {
        const resolved = ts.resolveModuleName(specifier, path.join(root, file.path), options, ts.sys, cache).resolvedModule
        if (!resolved) continue
        const relative = path.relative(root, resolved.resolvedFileName).split(path.sep).join('/')
        if (paths.has(relative)) dependencies.add(relative)
      }
      return [...dependencies].sort()
    }
    graph[file.path] = { eager: localPaths(eager), lazy: localPaths(lazy) }
  }
  return graph
}

export function findEagerCycles(graph) {
  const done = new Set()
  const visiting = new Set()
  const chain = []
  const cycles = []
  function walk(file) {
    if (visiting.has(file)) {
      cycles.push([...chain.slice(chain.indexOf(file)), file])
      return
    }
    if (done.has(file)) return
    chain.push(file)
    visiting.add(file)
    for (const target of graph[file].eager) walk(target)
    visiting.delete(file)
    chain.pop()
    done.add(file)
  }
  for (const file of Object.keys(graph)) walk(file)
  return cycles
}


/** 返回穿过任意中间模块的最短违规路径，包含延迟加载的依赖。 */
export function firstForbiddenPath(graph, start, targets) {
  if (!graph[start]) throw new Error(`依赖图缺少受保护的模块：${start}`)
  const pending = [[start]]
  const seen = new Set([start])
  for (let index = 0; index < pending.length; index++) {
    const chain = pending[index]
    const edges = graph[chain.at(-1)]
    for (const next of [...edges.eager, ...edges.lazy]) {
      if (targets.some(target => matchesTarget(next, target, true))) return [...chain, next]
      if (seen.has(next)) continue
      seen.add(next)
      pending.push([...chain, next])
    }
  }
  return null
}
