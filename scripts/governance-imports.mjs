import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import ts from 'typescript'
import { websiteCopyPlan } from '../atlas-website/public-files.mjs'

export function moduleReferences(source, file) {
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

export function journalBridgeDeclarationOwners(files) {
  const owners = { contract: [], window: [] }
  for (const { path, source } of files) {
    if (!/^(?:src|electron)\/.*\.tsx?$/s.test(path) || !/\b[Jj]ournalBridge\b/.test(source)) continue
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest)
    function visit(node) {
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text === 'JournalBridge') {
        owners.contract.push(path)
      }
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'Window') {
        for (const member of node.members) {
          if (member.name?.text === 'journalBridge') owners.window.push(path)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  return owners
}

function resolveSpecifier(importer, specifier) {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`
  if (specifier.startsWith('.')) return path.posix.join(path.posix.dirname(importer), specifier)
  return specifier
}

const codeExtension = /\.[cm]?[jt]sx?$/
const declarationExtension = /\.d\.[cm]?ts$/
const withoutExtension = value => value.replace(codeExtension, '')

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

/** 已发布的浏览器模块按构建产物的 URL 解析，根路径和 /guide/ 可能来自不同源码目录。 */
export function websiteDependencyGraph(root, files) {
  const scripts = files.filter(file => /\.m?js$/.test(file))
  const byUrl = new Map()
  for (const { source, relative, directory } of websiteCopyPlan(path.join(root, 'atlas-website'))) {
    const local = path.relative(root, source).split(path.sep).join('/')
    if (directory) {
      for (const file of scripts) {
        if (file.startsWith(local + '/')) byUrl.set('/' + relative + file.slice(local.length), file)
      }
    } else if (/\.m?js$/.test(relative)) {
      byUrl.set('/' + relative, local)
    }
  }
  const graph = {}
  for (const [url, file] of byUrl) {
    const { eager, lazy } = moduleReferences(readFileSync(path.join(root, file), 'utf8'), file)
    const parent = new URL(url, 'https://atlas.invalid')
    function resolveUrls(specifiers) {
      const paths = new Set()
      for (const specifier of specifiers) {
        if (!/^(?:\.{1,2}\/|\/|[a-z][a-z\d+.-]*:)/i.test(specifier)) {
          throw new Error(`官网模块无法解析裸导入：${file} → ${specifier}`)
        }
        const next = new URL(specifier, parent)
        if (next.origin !== parent.origin) continue
        const target = byUrl.get(decodeURIComponent(next.pathname))
        if (!target) throw new Error(`官网模块未发布：${file} → ${specifier}`)
        paths.add(target)
      }
      return [...paths].sort()
    }
    graph[file] = { eager: resolveUrls(eager), lazy: resolveUrls(lazy) }
  }
  return graph
}

/** 从入口追踪仓库内的运行时引用；即使中间文件位于其他交付物或工具目录也继续追踪。 */
export function runtimeDependencyGraph(files, directory, entryPoints) {
  const root = realpathSync(directory)
  const localModules = new Set(files.filter(file => codeExtension.test(file) && !declarationExtension.test(file)))
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const { options, errors } = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, root)
  if (errors.length) throw new Error(ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'))
  // 只查运行时实现，使相邻的 .d.ts 不会遮住真正加载的 JavaScript。
  const host = { ...ts.sys, fileExists: file => !declarationExtension.test(file) && ts.sys.fileExists(file) }
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
    function localPaths(specifiers, requireFromFile) {
      const dependencies = new Set()
      for (const specifier of specifiers) {
        const local = /^(?:\.{1,2}(?:\/|$)|@\/)/.test(specifier)
        let resolvedFile
        if (requireFromFile && local) {
          try {
            resolvedFile = requireFromFile.resolve(specifier)
          } catch (error) {
            throw new Error(`无法解析本地 CommonJS 引用：${file} → ${specifier}`, { cause: error })
          }
        } else {
          resolvedFile = ts.resolveModuleName(specifier, absolute, options, host, cache).resolvedModule?.resolvedFileName
          if (!resolvedFile && local && !/[?#]/.test(specifier) &&
              (codeExtension.test(specifier) || !path.posix.extname(specifier))) {
            throw new Error(`无法解析本地运行时模块：${file} → ${specifier}`)
          }
        }
        if (!resolvedFile) continue
        const relative = path.relative(root, resolvedFile).split(path.sep).join('/')
        if (localModules.has(relative)) {
          dependencies.add(relative)
          pending.add(relative)
        }
      }
      return [...dependencies].sort()
    }
    const requireFromFile = file.endsWith('.cjs') ? createRequire(absolute) : undefined
    graph[file] = { eager: localPaths(eager, requireFromFile), lazy: localPaths(lazy) }
  }
  return graph
}

/** 按入口截取完整子图，保留同步和延迟引用经过的所有本地模块。 */
export function reachableModuleGraph(graph, entryPoints) {
  const result = {}
  const pending = new Set(entryPoints)
  for (const file of pending) {
    const edges = graph[file]
    if (!edges) throw new Error(`依赖图缺少模块：${file}`)
    result[file] = edges
    for (const next of [...edges.eager, ...edges.lazy]) pending.add(next)
  }
  return result
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
