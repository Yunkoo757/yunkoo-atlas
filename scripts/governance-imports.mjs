import { readFileSync } from 'node:fs'
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

const withoutExtension = value => value.replace(/\.[cm]?[jt]sx?$/, '')

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

/** 从入口追踪仓库内的运行时引用；即使中间文件位于其他交付物或工具目录也继续追踪。 */
export function runtimeDependencyGraph(files, root, entryPoints) {
  const localModules = new Set(files.filter(file => /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file)))
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const { options, errors } = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, root)
  if (errors.length) throw new Error(ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'))
  const cache = ts.createModuleResolutionCache(root, file => file, options)
  const pending = new Set(entryPoints)
  const graph = {}
  for (const file of pending) {
    if (!localModules.has(file)) throw new Error(`依赖图缺少入口：${file}`)
    const absolute = path.join(root, file)
    const source = readFileSync(absolute, 'utf8')
    const emitted = /\.(?:[cm]?ts|tsx|jsx)$/.test(file)
      ? ts.transpileModule(source, { fileName: file, compilerOptions: options }).outputText
      : source
    const { eager, lazy } = moduleReferences(emitted, 'output.js')
    function localPaths(specifiers) {
      const dependencies = new Set()
      for (const specifier of specifiers) {
        const resolved = ts.resolveModuleName(specifier, absolute, options, ts.sys, cache).resolvedModule
        if (!resolved) continue
        const relative = path.relative(root, resolved.resolvedFileName).split(path.sep).join('/')
        if (localModules.has(relative)) {
          dependencies.add(relative)
          pending.add(relative)
        }
      }
      return [...dependencies].sort()
    }
    graph[file] = { eager: localPaths(eager), lazy: localPaths(lazy) }
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
