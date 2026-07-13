import {
  getNodePath,
  parseKotlinDeclarations,
  parseKotlinPackage,
  type SandboxFileNode,
  type SandboxNode,
} from './sandboxProject'

export interface ExportedSymbol {
  fileId: string
  filePath: string
  packageName: string
  importPath: string
  name: string
  kind: string
  signature: string
  parameters: string[]
  returnType: string
  implementation: string
  documentation?: string
  members: SymbolMember[]
}

export interface SymbolMember {
  kind: string
  name: string
  signature: string
}

export function buildKotlinFileSymbols(file: SandboxFileNode, nodes: SandboxNode[]): ExportedSymbol[] {
  const packageName = parseKotlinPackage(file.content)
  const filePath = getNodePath(file.id, nodes)

  return parseKotlinDeclarations(file.content).map((declaration) => ({
    fileId: file.id,
    filePath,
    packageName,
    importPath: packageName ? `${packageName}.${declaration.name}` : declaration.name,
    name: declaration.name,
    kind: declaration.kind,
    signature: declaration.signature,
    parameters: extractFunctionParameters(declaration.signature),
    returnType: extractReturnType(declaration.signature),
    implementation: declaration.implementation,
    members: ['class', 'interface', 'object'].includes(declaration.kind)
      ? extractClassMembers(file.content, declaration.name)
      : [],
  }))
}

export function extractClassMembers(content: string, className: string): SymbolMember[] {
  const declaration = parseKotlinDeclarations(content).find(
    (item) => ['class', 'interface', 'object'].includes(item.kind) && item.name === className,
  )
  const implementation = declaration?.implementation ?? `class ${className}`
  const signature = declaration?.signature ?? `class ${className}`
  const constructorProperties = extractFunctionParameters(signature)
    .map((parameter) => parameter.match(/\b(?:val|var)\s+([A-Za-z_]\w*)\s*:\s*([^,]+)/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      kind: 'val',
      name: match[1],
      signature: `val ${match[1]}: ${match[2].trim()}`,
    }))
  const bodyStart = implementation.indexOf('{')
  const bodyEnd = implementation.lastIndexOf('}')
  const body = bodyStart >= 0 && bodyEnd > bodyStart ? implementation.slice(bodyStart + 1, bodyEnd) : ''
  const bodyMembers = parseKotlinDeclarations(body).map((memberDeclaration) => ({
    kind: memberDeclaration.kind,
    name: memberDeclaration.name,
    signature: memberDeclaration.signature,
  }))

  return [...constructorProperties, ...bodyMembers]
}

export function syntheticDataClassMembers(symbol: ExportedSymbol): SymbolMember[] {
  if (!/^data\s+class\b/.test(symbol.signature)) {
    return []
  }

  const constructorParameters = symbol.parameters.map(normalizeConstructorParameter).filter(Boolean)
  const copySignature = `fun copy(${constructorParameters.join(', ')}): ${symbol.name}`
  const componentMembers = constructorParameters.map((parameter, index) => {
    const typeName = parameter.match(/:\s*(.+)$/)?.[1]?.trim() ?? 'Any?'

    return {
      kind: 'fun',
      name: `component${index + 1}`,
      signature: `operator fun component${index + 1}(): ${typeName}`,
    }
  })

  return [
    {
      kind: 'fun',
      name: 'copy',
      signature: copySignature,
    },
    ...componentMembers,
  ]
}

export function dedupeSymbolMembers(members: SymbolMember[]): SymbolMember[] {
  const seen = new Set<string>()

  return members.filter((member) => {
    const key = `${member.name}:${member.signature}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

export function extractFunctionParameters(signature: string): string[] {
  const start = signature.indexOf('(')

  if (start === -1) {
    return []
  }

  let depth = 0

  for (let index = start; index < signature.length; index += 1) {
    const char = signature[index]

    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1

      if (depth === 0) {
        return splitTopLevel(signature.slice(start + 1, index))
      }
    }
  }

  return []
}

export function extractReturnType(signature: string): string {
  return signature.match(/\)\s*:\s*([^={]+)$/)?.[1].trim() ?? ''
}

function normalizeConstructorParameter(parameter: string): string {
  return parameter
    .replace(/\b(?:public|internal|private|protected|override|val|var|vararg|crossinline|noinline)\s+/g, '')
    .trim()
}

function splitTopLevel(value: string): string[] {
  const result: string[] = []
  let current = ''
  let parenDepth = 0
  let angleDepth = 0
  let bracketDepth = 0

  for (const char of value) {
    if (char === ',' && parenDepth === 0 && angleDepth === 0 && bracketDepth === 0) {
      if (current.trim()) {
        result.push(current.trim())
      }

      current = ''
      continue
    }

    current += char

    if (char === '(') {
      parenDepth += 1
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1)
    } else if (char === '<') {
      angleDepth += 1
    } else if (char === '>') {
      angleDepth = Math.max(0, angleDepth - 1)
    } else if (char === '[') {
      bracketDepth += 1
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
    }
  }

  if (current.trim()) {
    result.push(current.trim())
  }

  return result
}
