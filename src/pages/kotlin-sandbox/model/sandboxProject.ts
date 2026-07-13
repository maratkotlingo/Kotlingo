export const ROOT_ID = 'root'
export const DEFAULT_ACTIVE_FILE_ID = 'file-main'

export type SandboxNodeKind = 'file' | 'folder'

interface SandboxNodeBase {
  id: string
  parentId: string | null
  name: string
  kind: SandboxNodeKind
}

export interface SandboxFileNode extends SandboxNodeBase {
  kind: 'file'
  content: string
}

export interface SandboxFolderNode extends SandboxNodeBase {
  kind: 'folder'
}

export type SandboxNode = SandboxFileNode | SandboxFolderNode

export interface KotlinImport {
  path: string
  alias?: string
}

export interface KotlinDeclaration {
  kind: string
  name: string
  implementation: string
  signature: string
  start: number
  end: number
}

export interface SandboxProjectMutation {
  nodes: SandboxNode[]
  affectedFileIds: string[]
}

export function createDefaultProject(): SandboxNode[] {
  return [
    { id: ROOT_ID, parentId: null, name: 'kotlingo-sandbox', kind: 'folder' },
    { id: 'folder-src', parentId: ROOT_ID, name: 'src', kind: 'folder' },
    { id: 'folder-playground', parentId: 'folder-src', name: 'playground', kind: 'folder' },
    {
      id: DEFAULT_ACTIVE_FILE_ID,
      parentId: 'folder-src',
      name: 'Main.kt',
      kind: 'file',
      content: `import playground.Greeter
import playground.User

fun main() {
    val greeter = Greeter(User("Kotlingo"))
    println(greeter.message())
}
`,
    },
    {
      id: 'file-greeter',
      parentId: 'folder-playground',
      name: 'Greeter.kt',
      kind: 'file',
      content: `package playground

class Greeter(private val user: User) {
    fun message(): String = "Hello, \${user.name}! Multi-file Kotlin is ready."
}
`,
    },
    {
      id: 'file-user',
      parentId: 'folder-playground',
      name: 'User.kt',
      kind: 'file',
      content: `package playground

data class User(val name: String)
`,
    },
  ]
}

export function isFileNode(node: SandboxNode | undefined): node is SandboxFileNode {
  return node?.kind === 'file'
}

export function isFolderNode(node: SandboxNode | undefined): node is SandboxFolderNode {
  return node?.kind === 'folder'
}

export function sortSandboxNodes(first: SandboxNode, second: SandboxNode): number {
  if (first.kind !== second.kind) {
    return first.kind === 'folder' ? -1 : 1
  }

  return first.name.localeCompare(second.name, 'ru', { sensitivity: 'base' })
}

export function createNodeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeFileName(name: string): string {
  const cleanName = sanitizeNodeName(name) || 'File.kt'

  if (cleanName.toLocaleLowerCase('en').endsWith('.kt')) {
    return cleanName
  }

  return `${cleanName.replace(/\.+$/, '')}.kt`
}

export function normalizeFolderName(name: string): string {
  return sanitizeNodeName(name) || 'folder'
}

export function makeUniqueNodeName(
  parentId: string,
  nodes: SandboxNode[],
  requestedName: string,
  currentNodeId?: string,
): string {
  const siblings = new Set(
    nodes
      .filter((node) => node.parentId === parentId && node.id !== currentNodeId)
      .map((node) => node.name.toLocaleLowerCase('ru')),
  )

  if (!siblings.has(requestedName.toLocaleLowerCase('ru'))) {
    return requestedName
  }

  const extensionMatch = requestedName.match(/(\.[^.]+)$/)
  const extension = extensionMatch?.[1] ?? ''
  const baseName = extension ? requestedName.slice(0, -extension.length) : requestedName

  let index = 2
  let candidate = `${baseName} ${index}${extension}`

  while (siblings.has(candidate.toLocaleLowerCase('ru'))) {
    index += 1
    candidate = `${baseName} ${index}${extension}`
  }

  return candidate
}

export function getNodePath(nodeId: string, nodes: SandboxNode[]): string {
  return getNodePathSegments(nodeId, nodes).join('/')
}

export function getNodePathSegments(nodeId: string, nodes: SandboxNode[]): string[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const segments: string[] = []
  let current = nodeMap.get(nodeId)

  while (current && current.id !== ROOT_ID) {
    segments.unshift(current.name)
    current = current.parentId ? nodeMap.get(current.parentId) : undefined
  }

  return segments
}

export function getDescendantIds(folderId: string, nodes: SandboxNode[]): string[] {
  const ids: string[] = []
  const visit = (parentId: string) => {
    nodes
      .filter((node) => node.parentId === parentId)
      .forEach((node) => {
        ids.push(node.id)

        if (isFolderNode(node)) {
          visit(node.id)
        }
      })
  }

  visit(folderId)
  return ids
}

export function packageNameFromFolder(folderId: string, nodes: SandboxNode[]): string {
  return getNodePathSegments(folderId, nodes)
    .filter((segment) => segment !== 'src')
    .map((segment) => segment.replace(/\.kt$/i, ''))
    .filter((segment) => /^[A-Za-z_][\w-]*$/.test(segment))
    .map((segment) => segment.replace(/-/g, '_'))
    .join('.')
}

export function sourceForNewKotlinFile(packageName: string): string {
  return packageName ? `package ${packageName}\n\n` : ''
}

export function parseKotlinPackage(content: string): string {
  return content.match(/^\s*package\s+([A-Za-z_][\w.]*)/m)?.[1] ?? ''
}

export function setKotlinPackage(content: string, packageName: string): string {
  const normalizedContent = content.replace(/\r\n/g, '\n')
  const packageRegex = /^\s*package\s+[A-Za-z_][\w.]*\s*\n?/m

  if (!packageName) {
    return normalizedContent.replace(packageRegex, '').replace(/^\n+/, '')
  }

  if (packageRegex.test(normalizedContent)) {
    return normalizedContent.replace(packageRegex, `package ${packageName}\n`)
  }

  return `package ${packageName}\n\n${normalizedContent.replace(/^\n+/, '')}`
}

export function parseKotlinImports(content: string): KotlinImport[] {
  const imports: KotlinImport[] = []
  const importRegex = /^\s*import\s+([A-Za-z_][\w.]*\*?)(?:\s+as\s+([A-Za-z_]\w*))?/gm
  let match: RegExpExecArray | null

  while ((match = importRegex.exec(content)) !== null) {
    imports.push({ path: match[1], alias: match[2] })
  }

  return imports
}

export function parseKotlinDeclarations(content: string): KotlinDeclaration[] {
  const normalizedContent = content.replace(/\r\n/g, '\n')
  const declarations: KotlinDeclaration[] = []
  const scannerState: KotlinNoiseScannerState = {
    blockCommentDepth: 0,
    inTripleString: false,
  }
  const lines = normalizedContent.split('\n')
  let depth = 0
  let offset = 0

  lines.forEach((line, index) => {
    const visibleLine = stripKotlinNoise(line, scannerState)
    const declaration = depth === 0 ? matchKotlinDeclarationLine(visibleLine) : null

    if (declaration) {
      const start = offset + declaration.index
      const implementation = extractKotlinDeclarationBlock(normalizedContent, start)
      declarations.push({
        ...declaration,
        implementation,
        signature: extractKotlinDeclarationSignature(implementation),
        start,
        end: start + implementation.length,
      })
    }

    depth = Math.max(0, depth + countIndentOpeners(visibleLine) - countIndentClosers(visibleLine))
    offset += line.length + (index < lines.length - 1 ? 1 : 0)
  })

  return declarations
}

export function moveSandboxNodeToFolder(
  nodes: SandboxNode[],
  nodeId: string,
  targetParentId: string,
): SandboxProjectMutation {
  const nodeMap = createSandboxNodeMap(nodes)
  const node = nodeMap.get(nodeId)
  const target = nodeMap.get(targetParentId)

  if (!node || !isFolderNode(target)) {
    return { nodes, affectedFileIds: [] }
  }

  const uniqueName = makeUniqueNodeName(targetParentId, nodes, node.name, node.id)
  const affectedFileIds = fileIdsForNode(node, nodes)
  const movedNodes = nodes.map((item) =>
    item.id === node.id
      ? {
          ...item,
          parentId: targetParentId,
          name: uniqueName,
        }
      : item,
  )

  return rewritePackagesAndImports(nodes, movedNodes, affectedFileIds)
}

export function renameSandboxNode(
  nodes: SandboxNode[],
  nodeId: string,
  requestedName: string,
): SandboxProjectMutation {
  const nodeMap = createSandboxNodeMap(nodes)
  const node = nodeMap.get(nodeId)

  if (!node || node.id === ROOT_ID) {
    return { nodes, affectedFileIds: [] }
  }

  const parentId = node.parentId ?? ROOT_ID
  const normalizedName = isFileNode(node) ? normalizeFileName(requestedName) : normalizeFolderName(requestedName)
  const uniqueName = makeUniqueNodeName(parentId, nodes, normalizedName, node.id)
  const renamedNodes = nodes.map((item) => (item.id === node.id ? { ...item, name: uniqueName } : item))

  if (isFileNode(node)) {
    return { nodes: renamedNodes, affectedFileIds: [] }
  }

  return rewritePackagesAndImports(nodes, renamedNodes, fileIdsForNode(node, nodes))
}

export function formatKotlinCode(content: string): string {
  const trimmedContent = content.replace(/\r\n/g, '\n').trim()

  if (!trimmedContent) {
    return ''
  }

  const formattedLines: string[] = []
  let indentLevel = 0

  trimmedContent.split('\n').forEach((line) => {
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      if (formattedLines.at(-1) !== '') {
        formattedLines.push('')
      }

      return
    }

    const visibleLine = stripLineComment(stripQuotedStrings(trimmedLine))
    const closingPrefix = visibleLine.match(/^[})\]]+/)?.[0].length ?? 0
    const lineIndent = Math.max(0, indentLevel - closingPrefix)

    formattedLines.push(`${' '.repeat(lineIndent * 4)}${trimmedLine}`)

    indentLevel = Math.max(
      0,
      indentLevel + countIndentOpeners(visibleLine) - countIndentClosers(visibleLine),
    )
  })

  return `${formattedLines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

function sanitizeNodeName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createSandboxNodeMap(nodes: SandboxNode[]): Map<string, SandboxNode> {
  return new Map(nodes.map((node) => [node.id, node]))
}

function fileIdsForNode(node: SandboxNode, nodes: SandboxNode[]): string[] {
  if (isFileNode(node)) {
    return [node.id]
  }

  const nodeMap = createSandboxNodeMap(nodes)
  return getDescendantIds(node.id, nodes).filter((nodeId) => isFileNode(nodeMap.get(nodeId)))
}

function rewritePackagesAndImports(
  previousNodes: SandboxNode[],
  nextNodes: SandboxNode[],
  affectedFileIds: string[],
): SandboxProjectMutation {
  if (affectedFileIds.length === 0) {
    return { nodes: nextNodes, affectedFileIds }
  }

  const packageUpdatedNodes = updatePackagesForFiles(nextNodes, affectedFileIds)
  const importChanges = buildImportChanges(previousNodes, packageUpdatedNodes, affectedFileIds)

  return {
    nodes: applyImportChanges(packageUpdatedNodes, importChanges, affectedFileIds),
    affectedFileIds,
  }
}

function updatePackagesForFiles(projectNodes: SandboxNode[], fileIds: string[]): SandboxNode[] {
  return projectNodes.map((item) => {
    if (!isFileNode(item) || !fileIds.includes(item.id)) {
      return item
    }

    return {
      ...item,
      content: setKotlinPackage(item.content, packageNameFromFolder(item.parentId ?? ROOT_ID, projectNodes)),
    }
  })
}

function buildImportChanges(
  previousNodes: SandboxNode[],
  nextNodes: SandboxNode[],
  fileIds: string[],
): ImportChanges {
  const additions: ImportAddition[] = []
  const replacements = new Map<string, string | null>()

  fileIds.forEach((fileId) => {
    const previousFile = previousNodes.find((item): item is SandboxFileNode => item.id === fileId && isFileNode(item))
    const nextFile = nextNodes.find((item): item is SandboxFileNode => item.id === fileId && isFileNode(item))

    if (!previousFile || !nextFile) {
      return
    }

    const previousPackage = parseKotlinPackage(previousFile.content)
    const nextPackage = parseKotlinPackage(nextFile.content)

    if (previousPackage === nextPackage) {
      return
    }

    parseKotlinDeclarations(previousFile.content).forEach((declaration) => {
      if (!previousPackage && nextPackage) {
        additions.push({
          importPath: `${nextPackage}.${declaration.name}`,
          packageName: nextPackage,
          symbolName: declaration.name,
        })
        return
      }

      const previousImport = `${previousPackage}.${declaration.name}`
      const nextImport = nextPackage ? `${nextPackage}.${declaration.name}` : null

      replacements.set(previousImport, nextImport)
    })
  })

  return { additions, replacements }
}

function applyImportChanges(
  projectNodes: SandboxNode[],
  changes: ImportChanges,
  affectedFileIds: string[],
): SandboxNode[] {
  if (changes.replacements.size === 0 && changes.additions.length === 0) {
    return projectNodes
  }

  return projectNodes.map((item) => {
    if (!isFileNode(item)) {
      return item
    }

    let content = item.content

    changes.replacements.forEach((nextImport, previousImport) => {
      const importRegex = new RegExp(
        `^\\s*import\\s+${escapeRegExp(previousImport)}\\s*(?:as\\s+[A-Za-z_]\\w*)?\\s*\\n?`,
        'gm',
      )

      content = content.replace(importRegex, (line) => {
        if (!nextImport) {
          return ''
        }

        return line.replace(previousImport, nextImport)
      })
    })

    if (!affectedFileIds.includes(item.id)) {
      changes.additions.forEach((addition) => {
        if (shouldInsertImportForMovedSymbol(content, addition)) {
          content = insertKotlinImport(content, addition.importPath)
        }
      })
    }

    return {
      ...item,
      content: content.replace(/\n{3,}/g, '\n\n'),
    }
  })
}

function shouldInsertImportForMovedSymbol(content: string, addition: ImportAddition): boolean {
  if (parseKotlinPackage(content) === addition.packageName) {
    return false
  }

  if (parseKotlinImports(content).some((importItem) => importItem.path === addition.importPath)) {
    return false
  }

  if (parseKotlinDeclarations(content).some((declaration) => declaration.name === addition.symbolName)) {
    return false
  }

  return new RegExp(`\\b${escapeRegExp(addition.symbolName)}\\b`).test(content)
}

function insertKotlinImport(content: string, importPath: string): string {
  const lines = content.split('\n')
  let insertIndex = 0
  let lastImportIndex = -1

  lines.forEach((line, index) => {
    if (/^\s*import\s+/.test(line)) {
      lastImportIndex = index
    }
  })

  if (lastImportIndex >= 0) {
    insertIndex = lastImportIndex + 1
  } else if (/^\s*package\s+/.test(lines[0] ?? '')) {
    insertIndex = lines[1] === '' ? 2 : 1
  }

  lines.splice(insertIndex, 0, `import ${importPath}`)
  return lines.join('\n')
}

interface KotlinNoiseScannerState {
  blockCommentDepth: number
  inTripleString: boolean
}

interface ImportAddition {
  importPath: string
  packageName: string
  symbolName: string
}

interface ImportChanges {
  additions: ImportAddition[]
  replacements: Map<string, string | null>
}

interface MatchedKotlinDeclaration {
  kind: string
  name: string
  index: number
}

function matchKotlinDeclarationLine(line: string): MatchedKotlinDeclaration | null {
  const prefixMatch = line.match(
    /^\s*(?:(?:@[\w.]+(?:\([^)]*\))?)\s+)*(?:(?:public|internal|private|protected|expect|actual|sealed|data|open|abstract|final|inner|value|enum|annotation|companion|suspend|inline|tailrec|operator|infix|external|const|lateinit|override)\s+)*/,
  )
  const prefix = prefixMatch?.[0] ?? ''
  const declarationStart = line.search(/\S/)

  if (declarationStart === -1) {
    return null
  }

  const rest = line.slice(prefix.length)
  const classLike = rest.match(/^(class|interface|object|typealias)\s+([A-Za-z_]\w*)\b/)

  if (classLike) {
    return createMatchedDeclaration(classLike[1], classLike[2], declarationStart)
  }

  const functionLike = rest.match(
    /^fun\s+(?:<[^>\n]+>\s*)?(?:(?:[A-Za-z_]\w*(?:<[^>\n]+>)?\s*\.)+)?([A-Za-z_]\w*)\s*(?:<[^>\n]+>\s*)?\(/,
  )

  if (functionLike) {
    return createMatchedDeclaration('fun', functionLike[1], declarationStart)
  }

  const propertyLike = rest.match(/^(val|var)\s+([A-Za-z_]\w*)\b/)

  if (propertyLike) {
    return createMatchedDeclaration(propertyLike[1], propertyLike[2], declarationStart)
  }

  return null
}

function createMatchedDeclaration(kind: string, name: string, index: number): MatchedKotlinDeclaration {
  return { kind, name, index }
}

function stripKotlinNoise(line: string, state: KotlinNoiseScannerState): string {
  let result = ''
  let index = 0

  while (index < line.length) {
    if (state.inTripleString) {
      const closeIndex = line.indexOf('"""', index)

      if (closeIndex === -1) {
        return result.padEnd(line.length, ' ')
      }

      result += ' '.repeat(closeIndex + 3 - index)
      index = closeIndex + 3
      state.inTripleString = false
      continue
    }

    if (state.blockCommentDepth > 0) {
      if (line.startsWith('/*', index)) {
        state.blockCommentDepth += 1
        result += '  '
        index += 2
        continue
      }

      if (line.startsWith('*/', index)) {
        state.blockCommentDepth -= 1
        result += '  '
        index += 2
        continue
      }

      result += ' '
      index += 1
      continue
    }

    if (line.startsWith('//', index)) {
      return result.padEnd(line.length, ' ')
    }

    if (line.startsWith('/*', index)) {
      state.blockCommentDepth += 1
      result += '  '
      index += 2
      continue
    }

    if (line.startsWith('"""', index)) {
      state.inTripleString = true
      result += '   '
      index += 3
      continue
    }

    if (line[index] === '"' || line[index] === "'") {
      const quote = line[index]
      result += ' '
      index += 1

      while (index < line.length) {
        const char = line[index]
        result += ' '
        index += char === '\\' ? 2 : 1

        if (char === quote) {
          break
        }
      }

      continue
    }

    result += line[index]
    index += 1
  }

  return result
}

function extractKotlinDeclarationBlock(content: string, start: number): string {
  const firstBrace = content.indexOf('{', start)
  const lineEnd = content.indexOf('\n', start)
  const nextLineEnd = lineEnd === -1 ? content.length : lineEnd

  if (firstBrace === -1 || firstBrace > nextLineEnd) {
    return content.slice(start, nextLineEnd)
  }

  let depth = 0
  let quote: string | null = null
  let escaped = false
  let inTripleString = false
  let blockCommentDepth = 0

  for (let index = firstBrace; index < content.length; index += 1) {
    const char = content[index]

    if (inTripleString) {
      if (content.startsWith('"""', index)) {
        inTripleString = false
        index += 2
      }
      continue
    }

    if (blockCommentDepth > 0) {
      if (content.startsWith('/*', index)) {
        blockCommentDepth += 1
        index += 1
      } else if (content.startsWith('*/', index)) {
        blockCommentDepth -= 1
        index += 1
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (content.startsWith('//', index)) {
      const commentEnd = content.indexOf('\n', index)
      index = commentEnd === -1 ? content.length : commentEnd
      continue
    }

    if (content.startsWith('/*', index)) {
      blockCommentDepth = 1
      index += 1
      continue
    }

    if (content.startsWith('"""', index)) {
      inTripleString = true
      index += 2
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1

      if (depth === 0) {
        return content.slice(start, index + 1)
      }
    }
  }

  return content.slice(start)
}

function extractKotlinDeclarationSignature(implementation: string): string {
  return implementation
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .replace(/\s*\{\s*$/, '')
    .replace(/\s*=\s*.*$/, '')
    .trim()
}

function stripLineComment(line: string): string {
  const commentIndex = line.indexOf('//')

  if (commentIndex === -1) {
    return line
  }

  return line.slice(0, commentIndex)
}

function stripQuotedStrings(line: string): string {
  return line
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])'/g, "''")
}

function countIndentOpeners(line: string): number {
  return (line.match(/[({\[]/g) ?? []).length
}

function countIndentClosers(line: string): number {
  return (line.match(/[)}\]]/g) ?? []).length
}
