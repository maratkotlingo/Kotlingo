<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  completionKeymap,
  snippetCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { kotlin } from '@codemirror/legacy-modes/mode/clike'
import { Compartment, EditorState, type Extension, type Range } from '@codemirror/state'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import {
  Decoration,
  EditorView,
  type HoverTooltipSource,
  ViewPlugin,
  WidgetType,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Trash2,
  Wand2,
  X,
} from '@lucide/vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import CourseTopBar from '@/widgets/course-layout/ui/CourseTopBar.vue'
import SandboxDiagnosticsPanel from '@/pages/kotlin-sandbox/ui/SandboxDiagnosticsPanel.vue'
import SandboxRunPanel from '@/pages/kotlin-sandbox/ui/SandboxRunPanel.vue'
import { buttons, form, layout, tagBase } from '@/shared/config/ui'
import {
  DEFAULT_ACTIVE_FILE_ID,
  ROOT_ID,
  createDefaultProject,
  createNodeId,
  formatKotlinCode,
  getDescendantIds,
  getNodePath,
  isFileNode,
  isFolderNode,
  makeUniqueNodeName,
  moveSandboxNodeToFolder,
  normalizeFileName,
  normalizeFolderName,
  packageNameFromFolder,
  parseKotlinImports,
  parseKotlinPackage,
  renameSandboxNode,
  sortSandboxNodes,
  sourceForNewKotlinFile,
  type KotlinImport,
  type SandboxFileNode,
  type SandboxFolderNode,
  type SandboxNode,
} from '@/pages/kotlin-sandbox/model/sandboxProject'
import {
  buildKotlinFileSymbols,
  dedupeSymbolMembers,
  extractFunctionParameters,
  extractReturnType,
  syntheticDataClassMembers,
  type ExportedSymbol,
  type SymbolMember,
} from '@/pages/kotlin-sandbox/model/sandboxSymbols'
import {
  FALLBACK_KOTLIN_VERSION,
  cleanCompilerText,
  fetchKotlinCompilerVersions,
  flattenCompilerDiagnostics,
  formatCompilerException,
  prepareCompilerProject,
  resolveLatestStableVersion,
  runKotlinProject,
  type KotlinCompilerVersion,
  type RuntimeDiagnostic,
} from '@/pages/kotlin-sandbox/model/kotlinCompiler'

type RunStatus = 'idle' | 'running' | 'success' | 'error'
type ImportStatus = 'resolved' | 'missing' | 'wildcard' | 'external'

interface SelectOption {
  label: string
  value: string
}

interface VisibleNode {
  node: SandboxNode
  depth: number
}

interface StoredSandboxState {
  nodes: SandboxNode[]
  activeFileId: string
  selectedNodeId: string
  openFileIds?: string[]
  expandedFolderIds: string[]
  compilerVersion: string
  args: string
}

interface ImportResolution extends KotlinImport {
  status: ImportStatus
  targetFilePath?: string
}

interface CompletionQuery {
  from: number
  to: number
  prefix: string
  mode: 'default' | 'import' | 'member'
  qualifier?: string
  memberExpression?: string
  documentContent?: string
  cursorPosition: number
}

type KotlinTypeCategory =
  | 'unknown'
  | 'user'
  | 'string'
  | 'char'
  | 'boolean'
  | 'number'
  | 'list'
  | 'mutableList'
  | 'set'
  | 'mutableSet'
  | 'map'
  | 'mutableMap'
  | 'mapEntry'
  | 'array'
  | 'primitiveArray'
  | 'sequence'
  | 'iterable'
  | 'pair'
  | 'result'
  | 'unit'

interface KotlinTypeInfo {
  name: string
  category: KotlinTypeCategory
  symbol?: ExportedSymbol
  genericArguments: string[]
  nullable: boolean
}

interface TypeInferenceContext {
  cursorPosition?: number
}

interface LambdaParameterInfo {
  name: string
  explicitType?: string
}

interface LambdaCallContext {
  callName: string
  receiverExpression?: string
  receiverType?: KotlinTypeInfo
  callArguments: string[]
}

interface KotlinMemberInfo {
  label: string
  type: string
  signature: string
  returnType?: string
  detail?: string
  section?: string
  boost?: number
  description?: string
}

interface InlineSuggestion {
  from: number
  to: number
  insertText: string
  suffix: string
}

const STORAGE_KEY = 'kotlingo.kotlin-sandbox.v1'
const LATEST_VERSION_VALUE = 'latest'
const defaultExpandedFolderIds = [ROOT_ID, 'folder-src', 'folder-playground']
const diagnosticsCompartment = new Compartment()

const nodes = ref<SandboxNode[]>(createDefaultProject())
const activeFileId = ref(DEFAULT_ACTIVE_FILE_ID)
const selectedNodeId = ref(DEFAULT_ACTIVE_FILE_ID)
const openFileIds = ref<string[]>([DEFAULT_ACTIVE_FILE_ID])
const expandedFolderIds = ref<string[]>([...defaultExpandedFolderIds])
const renameDraft = ref('')
const fileSearchQuery = ref('')
const draggedNodeId = ref('')
const dragTargetNodeId = ref('')
const compilerVersions = ref<KotlinCompilerVersion[]>([])
const compilerVersionsLoading = ref(false)
const compilerVersionsError = ref('')
const selectedCompilerVersion = ref(LATEST_VERSION_VALUE)
const programArgs = ref('')
const runStatus = ref<RunStatus>('idle')
const runOutput = ref('Нажмите «Запустить», чтобы собрать проект на актуальном Kotlin compiler backend.')
const diagnostics = ref<RuntimeDiagnostic[]>([])
const lastRunAt = ref('')
const copiedImportPath = ref('')
const editorHostRef = ref<HTMLElement | null>(null)
const editorView = shallowRef<EditorView | null>(null)
const hasHydrated = ref(false)
let realtimeDiagnosticsTimer: number | undefined

const nodeMap = computed(() => new Map(nodes.value.map((node) => [node.id, node])))
const files = computed(() => nodes.value.filter(isFileNode))
const folders = computed(() => nodes.value.filter(isFolderNode))
const activeFile = computed<SandboxFileNode | undefined>(
  () => files.value.find((file) => file.id === activeFileId.value) ?? files.value[0],
)
const selectedNode = computed(() => nodeMap.value.get(selectedNodeId.value) ?? activeFile.value)
const selectedFolder = computed<SandboxFolderNode | undefined>(() => {
  if (isFolderNode(selectedNode.value)) {
    return selectedNode.value
  }

  return nodeMap.value.get(activeFile.value?.parentId ?? ROOT_ID) as SandboxFolderNode | undefined
})
const activeFilePath = computed(() => (activeFile.value ? getNodePath(activeFile.value.id, nodes.value) : ''))
const activePackage = computed(() => parseKotlinPackage(activeFile.value?.content ?? ''))
const openFiles = computed(() =>
  openFileIds.value
    .map((fileId) => files.value.find((file) => file.id === fileId))
    .filter((file): file is SandboxFileNode => Boolean(file)),
)
const projectStats = computed(() => ({
  files: files.value.length,
  folders: Math.max(0, folders.value.length - 1),
}))
const normalizedFileSearchQuery = computed(() => fileSearchQuery.value.trim().toLocaleLowerCase('ru'))
const visibleNodes = computed<VisibleNode[]>(() => {
  const result: VisibleNode[] = []

  if (normalizedFileSearchQuery.value) {
    appendSearchVisibleChildren(ROOT_ID, 0, result)
  } else {
    appendVisibleChildren(ROOT_ID, 0, result)
  }

  return result
})
const visibleFileCount = computed(() => visibleNodes.value.filter((item) => isFileNode(item.node)).length)
const latestStableVersion = computed(() => resolveLatestStableVersion(compilerVersions.value))
const resolvedCompilerVersion = computed(() =>
  selectedCompilerVersion.value === LATEST_VERSION_VALUE ? latestStableVersion.value : selectedCompilerVersion.value,
)
const compilerVersionOptions = computed<SelectOption[]>(() => [
  {
    label: `Latest stable (${latestStableVersion.value || FALLBACK_KOTLIN_VERSION})`,
    value: LATEST_VERSION_VALUE,
  },
  ...compilerVersions.value.map((version) => ({
    label: version.latestStable ? `${version.version} stable` : version.version,
    value: version.version,
  })),
])
const localSymbols = computed<ExportedSymbol[]>(() => files.value.flatMap((file) => buildKotlinFileSymbols(file, nodes.value)))
const exportedSymbols = computed<ExportedSymbol[]>(() =>
  localSymbols.value.filter((symbol) => symbol.fileId !== activeFileId.value && symbol.packageName),
)
const currentImports = computed<ImportResolution[]>(() =>
  parseKotlinImports(activeFile.value?.content ?? '').map((importItem) => resolveImport(importItem)),
)
const unresolvedImports = computed(() => currentImports.value.filter((item) => item.status === 'missing'))
const compilerErrorCount = computed(() => diagnostics.value.filter((diagnostic) => diagnostic.severity === 'ERROR').length)
const canDeleteSelected = computed(() => Boolean(selectedNode.value && selectedNode.value.id !== ROOT_ID))

const kotlinHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#a78bfa', fontWeight: '800' },
  { tag: [tags.name, tags.variableName], color: '#f7fbff' },
  { tag: [tags.function(tags.variableName), tags.function(tags.name)], color: '#38f2c2', fontWeight: '800' },
  { tag: [tags.className, tags.typeName], color: '#fb7185', fontWeight: '800' },
  { tag: [tags.string, tags.special(tags.string)], color: '#fbbf24' },
  { tag: [tags.number, tags.bool, tags.null], color: '#60a5fa' },
  { tag: tags.comment, color: '#66758d', fontStyle: 'italic' },
  { tag: tags.operator, color: '#9aa8bd' },
])

const kotlingoEditorTheme = EditorView.theme(
  {
    '&': {
      minHeight: 'min(68vh, 760px)',
      backgroundColor: 'var(--color-app-soft)',
      color: 'var(--color-ink)',
      fontFamily: 'var(--font-mono)',
    },
    '.cm-scroller': {
      minHeight: 'min(68vh, 760px)',
      fontFamily: 'var(--font-mono)',
      fontSize: '14px',
      lineHeight: '1.5',
    },
    '.cm-content': {
      minHeight: 'min(68vh, 760px)',
      padding: '16px 0',
      caretColor: 'var(--color-accent)',
    },
    '.cm-line': {
      padding: '0 16px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-app)',
      borderRight: '1px solid var(--color-line)',
      color: 'var(--color-muted-soft)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '44px',
      padding: '0 12px 0 8px',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgb(56 242 194 / 0.06)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgb(56 242 194 / 0.1)',
      color: 'var(--color-accent)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgb(56 242 194 / 0.22)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--color-accent)',
    },
    '.cm-kotlingo-diagnostic-line-error': {
      backgroundColor: 'rgb(251 113 133 / 0.08)',
      boxShadow: 'inset 3px 0 0 var(--color-rose)',
    },
    '.cm-kotlingo-diagnostic-line-warning': {
      backgroundColor: 'rgb(251 191 36 / 0.07)',
      boxShadow: 'inset 3px 0 0 var(--color-amber)',
    },
    '.cm-kotlingo-diagnostic-mark-error': {
      textDecoration: 'underline wavy var(--color-rose)',
      textUnderlineOffset: '3px',
    },
    '.cm-kotlingo-diagnostic-mark-warning': {
      textDecoration: 'underline wavy var(--color-amber)',
      textUnderlineOffset: '3px',
    },
    '.cm-tooltip': {
      zIndex: '80',
      border: '1px solid var(--color-line)',
      borderRadius: 'var(--radius-card)',
      backgroundColor: 'var(--color-panel-raised)',
      color: 'var(--color-ink)',
      boxShadow: 'var(--shadow-panel)',
      overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete ul': {
      fontFamily: 'var(--font-sans)',
      maxHeight: '280px',
    },
    '.cm-tooltip-autocomplete ul li': {
      padding: '6px 10px',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'rgb(56 242 194 / 0.16)',
      color: 'var(--color-accent)',
    },
    '.cm-completionDetail': {
      color: 'var(--color-muted)',
      marginLeft: '12px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': {
      color: 'var(--color-ink)',
    },
    '.cm-kotlingo-inline-suggestion': {
      color: 'var(--color-muted-soft)',
      opacity: '0.72',
      pointerEvents: 'none',
    },
    '.cm-kotlingo-hover': {
      display: 'grid',
      gap: '10px',
      maxWidth: 'min(620px, 88vw)',
      maxHeight: 'min(520px, calc(100vh - var(--header-height) - 48px))',
      overflow: 'auto',
      padding: '12px',
      fontFamily: 'var(--font-sans)',
      color: 'var(--color-ink)',
    },
    '.cm-kotlingo-hover-signature': {
      margin: '0',
      whiteSpace: 'pre-wrap',
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
      lineHeight: '1.6',
      color: 'var(--color-accent)',
    },
    '.cm-kotlingo-hover-meta': {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      margin: '0',
      color: 'var(--color-muted)',
      fontSize: '12px',
      fontWeight: '700',
    },
    '.cm-kotlingo-hover-chip': {
      border: '1px solid var(--color-line)',
      borderRadius: '999px',
      padding: '3px 8px',
      backgroundColor: 'var(--color-app-soft)',
    },
    '.cm-kotlingo-hover-doc': {
      margin: '0',
      color: 'var(--color-ink)',
      fontSize: '13px',
      lineHeight: '1.65',
    },
    '.cm-kotlingo-hover-members': {
      display: 'grid',
      gap: '5px',
      margin: '0',
      color: 'var(--color-muted)',
      fontSize: '12px',
    },
    '.cm-kotlingo-hover-members code': {
      color: 'var(--color-ink)',
      fontFamily: 'var(--font-mono)',
    },
    '.cm-kotlingo-hover-section-title': {
      margin: '0 0 2px',
      color: 'var(--color-muted)',
      fontSize: '11px',
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: '0',
    },
    '.cm-kotlingo-hover-params': {
      display: 'grid',
      gap: '5px',
      margin: '0',
      padding: '8px 10px',
      border: '1px solid var(--color-line)',
      borderRadius: 'var(--radius-card)',
      backgroundColor: 'var(--color-app-soft)',
      color: 'var(--color-ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      lineHeight: '1.55',
    },
    '.cm-kotlingo-hover details': {
      border: '1px solid var(--color-line)',
      borderRadius: 'var(--radius-card)',
      backgroundColor: 'var(--color-app-soft)',
      overflow: 'hidden',
    },
    '.cm-kotlingo-hover summary': {
      cursor: 'pointer',
      padding: '8px 10px',
      color: 'var(--color-accent)',
      fontSize: '12px',
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: '0',
    },
    '.cm-kotlingo-hover pre': {
      maxHeight: '280px',
      overflow: 'auto',
      margin: '0',
      borderTop: '1px solid var(--color-line)',
      padding: '10px',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      lineHeight: '1.55',
      color: 'var(--color-ink)',
    },
  },
  { dark: true },
)

const kotlinKeywords = [
  'as',
  'break',
  'class',
  'continue',
  'do',
  'else',
  'false',
  'for',
  'fun',
  'if',
  'in',
  'interface',
  'is',
  'null',
  'object',
  'package',
  'return',
  'super',
  'this',
  'throw',
  'true',
  'try',
  'typealias',
  'val',
  'var',
  'when',
  'while',
  'by',
  'catch',
  'constructor',
  'delegate',
  'dynamic',
  'field',
  'file',
  'finally',
  'get',
  'import',
  'init',
  'param',
  'property',
  'receiver',
  'set',
  'setparam',
  'where',
  'actual',
  'abstract',
  'annotation',
  'companion',
  'const',
  'crossinline',
  'data',
  'enum',
  'expect',
  'external',
  'final',
  'infix',
  'inline',
  'inner',
  'internal',
  'lateinit',
  'noinline',
  'open',
  'operator',
  'out',
  'override',
  'private',
  'protected',
  'public',
  'reified',
  'sealed',
  'suspend',
  'tailrec',
  'value',
  'vararg',
]

interface KotlinStdlibDoc {
  kind: string
  signature: string
  returnType?: string
  description: string
  section: string
}

const kotlinStdlibDocs: Record<string, KotlinStdlibDoc> = {
  Any: {
    kind: 'class',
    signature: 'open class Any',
    description: 'Корневой тип Kotlin: у любого значения есть методы toString(), equals() и hashCode().',
    section: 'Базовые типы',
  },
  Unit: {
    kind: 'object',
    signature: 'object Unit',
    description: 'Тип результата функции, которая ничего полезного не возвращает. Аналог void, но является настоящим значением.',
    section: 'Базовые типы',
  },
  Nothing: {
    kind: 'class',
    signature: 'class Nothing',
    description: 'Тип выражений, которые никогда не завершаются нормально: throw, error(), бесконечный цикл.',
    section: 'Базовые типы',
  },
  String: {
    kind: 'class',
    signature: 'class String : Comparable<String>, CharSequence',
    description: 'Неизменяемая строка. Поддерживает индексацию по символам, поиск, преобразования регистра, split/trim/replace.',
    section: 'Текст',
  },
  Char: {
    kind: 'class',
    signature: 'class Char : Comparable<Char>',
    description: 'Один Unicode-символ. Удобен для проверок isDigit(), isLetter(), преобразований регистра и получения code.',
    section: 'Текст',
  },
  Boolean: {
    kind: 'class',
    signature: 'class Boolean : Comparable<Boolean>',
    description: 'Логический тип true/false. Используется в условиях if, when, фильтрах и предикатах.',
    section: 'Базовые типы',
  },
  Byte: { kind: 'class', signature: 'class Byte : Number', description: '8-битное целое число со знаком.', section: 'Числа' },
  Short: { kind: 'class', signature: 'class Short : Number', description: '16-битное целое число со знаком.', section: 'Числа' },
  Int: { kind: 'class', signature: 'class Int : Number', description: 'Основной тип целых чисел. По умолчанию литерал 42 имеет тип Int.', section: 'Числа' },
  Long: { kind: 'class', signature: 'class Long : Number', description: '64-битное целое число. Литерал можно записать как 42L.', section: 'Числа' },
  Float: { kind: 'class', signature: 'class Float : Number', description: '32-битное число с плавающей точкой. Литерал обычно пишут с суффиксом F.', section: 'Числа' },
  Double: { kind: 'class', signature: 'class Double : Number', description: '64-битное число с плавающей точкой. Дробные литералы по умолчанию имеют тип Double.', section: 'Числа' },
  Array: {
    kind: 'class',
    signature: 'class Array<T>',
    description: 'Массив фиксированного размера. Элементы можно читать и менять по индексу: array[index].',
    section: 'Коллекции',
  },
  IntArray: { kind: 'class', signature: 'class IntArray', description: 'Примитивный массив Int без boxing. Быстрее и компактнее Array<Int>.', section: 'Массивы' },
  LongArray: { kind: 'class', signature: 'class LongArray', description: 'Примитивный массив Long без boxing.', section: 'Массивы' },
  DoubleArray: { kind: 'class', signature: 'class DoubleArray', description: 'Примитивный массив Double без boxing.', section: 'Массивы' },
  FloatArray: { kind: 'class', signature: 'class FloatArray', description: 'Примитивный массив Float без boxing.', section: 'Массивы' },
  BooleanArray: { kind: 'class', signature: 'class BooleanArray', description: 'Примитивный массив Boolean без boxing.', section: 'Массивы' },
  CharArray: { kind: 'class', signature: 'class CharArray', description: 'Примитивный массив Char. Часто используется для посимвольной обработки текста.', section: 'Массивы' },
  List: {
    kind: 'interface',
    signature: 'interface List<out T> : Collection<T>',
    description: 'Read-only список: порядок элементов сохранен, доступ по индексу есть, менять содержимое через List нельзя.',
    section: 'Коллекции',
  },
  MutableList: {
    kind: 'interface',
    signature: 'interface MutableList<T> : List<T>, MutableCollection<T>',
    description: 'Изменяемый список: можно add/remove/set, сортировать, перемешивать и менять элементы по индексу.',
    section: 'Коллекции',
  },
  Set: {
    kind: 'interface',
    signature: 'interface Set<out T> : Collection<T>',
    description: 'Read-only множество уникальных элементов. Нет доступа по индексу, зато удобно проверять contains().',
    section: 'Коллекции',
  },
  MutableSet: {
    kind: 'interface',
    signature: 'interface MutableSet<T> : Set<T>, MutableCollection<T>',
    description: 'Изменяемое множество уникальных элементов: add(), remove(), clear().',
    section: 'Коллекции',
  },
  Map: {
    kind: 'interface',
    signature: 'interface Map<out K, V>',
    description: 'Read-only словарь ключ -> значение. Чтение через map[key], getValue(), keys, values, entries.',
    section: 'Коллекции',
  },
  MutableMap: {
    kind: 'interface',
    signature: 'interface MutableMap<K, V> : Map<K, V>',
    description: 'Изменяемый словарь: put(), remove(), getOrPut(), clear(), плюс все read-only операции Map.',
    section: 'Коллекции',
  },
  Iterable: {
    kind: 'interface',
    signature: 'interface Iterable<out T>',
    description: 'Тип, по которому можно пройтись циклом for. Большинство коллекций реализуют Iterable.',
    section: 'Коллекции',
  },
  Sequence: {
    kind: 'interface',
    signature: 'interface Sequence<out T>',
    description: 'Ленивая цепочка преобразований. Полезна для больших данных и длинных map/filter pipeline.',
    section: 'Коллекции',
  },
  Pair: {
    kind: 'data class',
    signature: 'data class Pair<out A, out B>(val first: A, val second: B)',
    description: 'Пара значений first/second. Удобна для временных результатов, но для доменной модели лучше data class.',
    section: 'Базовые типы',
  },
  Triple: {
    kind: 'data class',
    signature: 'data class Triple<out A, out B, out C>',
    description: 'Тройка значений first/second/third. Для читаемого API обычно лучше named data class.',
    section: 'Базовые типы',
  },
  Result: {
    kind: 'class',
    signature: 'value class Result<out T>',
    description: 'Контейнер успеха или ошибки. Используйте runCatching(), map(), recover(), getOrThrow().',
    section: 'Ошибки',
  },
  Comparable: { kind: 'interface', signature: 'interface Comparable<in T>', description: 'Тип, который умеет сравниваться с другим значением через compareTo().', section: 'Базовые типы' },
  Comparator: { kind: 'interface', signature: 'fun interface Comparator<T>', description: 'Объект сравнения для сортировки: sortedWith(), sortWith(), compareBy().', section: 'Базовые типы' },
  Throwable: { kind: 'class', signature: 'open class Throwable', description: 'Базовый тип всех исключений и ошибок.', section: 'Ошибки' },
  Exception: { kind: 'class', signature: 'open class Exception : Throwable', description: 'Базовый класс обычных исключительных ситуаций.', section: 'Ошибки' },
  IllegalArgumentException: { kind: 'class', signature: 'class IllegalArgumentException : RuntimeException', description: 'Исключение для неверных аргументов функции. Часто бросается require().', section: 'Ошибки' },
  IllegalStateException: { kind: 'class', signature: 'class IllegalStateException : RuntimeException', description: 'Исключение для некорректного состояния объекта. Часто бросается check().', section: 'Ошибки' },
  println: { kind: 'fun', signature: 'fun println(message: Any?): Unit', returnType: 'Unit', description: 'Печатает значение и перевод строки в stdout.', section: 'Ввод/вывод' },
  print: { kind: 'fun', signature: 'fun print(message: Any?): Unit', returnType: 'Unit', description: 'Печатает значение в stdout без перевода строки.', section: 'Ввод/вывод' },
  readln: { kind: 'fun', signature: 'fun readln(): String', returnType: 'String', description: 'Читает строку из stdin. В этой браузерной песочнице stdin пока не передается, поэтому readln() может получить EOF.', section: 'Ввод/вывод' },
  readLine: { kind: 'fun', signature: 'fun readLine(): String?', returnType: 'String?', description: 'Nullable-версия чтения строки из stdin. Возвращает null при EOF.', section: 'Ввод/вывод' },
  TODO: { kind: 'fun', signature: 'fun TODO(reason: String = ""): Nothing', returnType: 'Nothing', description: 'Заглушка: при выполнении бросает NotImplementedError и имеет тип Nothing.', section: 'Ошибки' },
  require: { kind: 'fun', signature: 'fun require(value: Boolean, lazyMessage: () -> Any): Unit', returnType: 'Unit', description: 'Проверяет аргументы функции. Если условие false, бросает IllegalArgumentException.', section: 'Проверки' },
  requireNotNull: { kind: 'fun', signature: 'fun <T : Any> requireNotNull(value: T?): T', returnType: 'T', description: 'Проверяет, что аргумент не null, и возвращает smart non-null значение.', section: 'Проверки' },
  check: { kind: 'fun', signature: 'fun check(value: Boolean, lazyMessage: () -> Any): Unit', returnType: 'Unit', description: 'Проверяет состояние объекта. Если условие false, бросает IllegalStateException.', section: 'Проверки' },
  checkNotNull: { kind: 'fun', signature: 'fun <T : Any> checkNotNull(value: T?): T', returnType: 'T', description: 'Проверяет, что состояние не null, и возвращает non-null значение.', section: 'Проверки' },
  error: { kind: 'fun', signature: 'fun error(message: Any): Nothing', returnType: 'Nothing', description: 'Немедленно бросает IllegalStateException. Удобно для невозможных веток when/else.', section: 'Ошибки' },
  run: { kind: 'fun', signature: 'inline fun <R> run(block: () -> R): R', returnType: 'R', description: 'Выполняет блок и возвращает его результат. Удобно для локального scope.', section: 'Scope functions' },
  with: { kind: 'fun', signature: 'inline fun <T, R> with(receiver: T, block: T.() -> R): R', returnType: 'R', description: 'Выполняет блок на receiver без создания цепочки вызовов.', section: 'Scope functions' },
  runCatching: { kind: 'fun', signature: 'inline fun <R> runCatching(block: () -> R): Result<R>', returnType: 'Result<R>', description: 'Запускает блок и упаковывает успех или исключение в Result.', section: 'Ошибки' },
  lazy: { kind: 'fun', signature: 'fun <T> lazy(initializer: () -> T): Lazy<T>', returnType: 'Lazy<T>', description: 'Создает ленивое значение: initializer выполнится только при первом обращении.', section: 'Делегаты' },
  listOf: { kind: 'fun', signature: 'fun <T> listOf(vararg elements: T): List<T>', returnType: 'List<T>', description: 'Создает read-only список из переданных элементов.', section: 'Коллекции' },
  mutableListOf: { kind: 'fun', signature: 'fun <T> mutableListOf(vararg elements: T): MutableList<T>', returnType: 'MutableList<T>', description: 'Создает изменяемый список.', section: 'Коллекции' },
  setOf: { kind: 'fun', signature: 'fun <T> setOf(vararg elements: T): Set<T>', returnType: 'Set<T>', description: 'Создает read-only множество уникальных элементов.', section: 'Коллекции' },
  mutableSetOf: { kind: 'fun', signature: 'fun <T> mutableSetOf(vararg elements: T): MutableSet<T>', returnType: 'MutableSet<T>', description: 'Создает изменяемое множество.', section: 'Коллекции' },
  mapOf: { kind: 'fun', signature: 'fun <K, V> mapOf(vararg pairs: Pair<K, V>): Map<K, V>', returnType: 'Map<K, V>', description: 'Создает read-only словарь. Пары обычно пишутся как key to value.', section: 'Коллекции' },
  mutableMapOf: { kind: 'fun', signature: 'fun <K, V> mutableMapOf(vararg pairs: Pair<K, V>): MutableMap<K, V>', returnType: 'MutableMap<K, V>', description: 'Создает изменяемый словарь.', section: 'Коллекции' },
  arrayOf: { kind: 'fun', signature: 'fun <T> arrayOf(vararg elements: T): Array<T>', returnType: 'Array<T>', description: 'Создает массив фиксированного размера.', section: 'Массивы' },
  intArrayOf: { kind: 'fun', signature: 'fun intArrayOf(vararg elements: Int): IntArray', returnType: 'IntArray', description: 'Создает примитивный IntArray без boxing.', section: 'Массивы' },
  sequenceOf: { kind: 'fun', signature: 'fun <T> sequenceOf(vararg elements: T): Sequence<T>', returnType: 'Sequence<T>', description: 'Создает ленивую Sequence из элементов.', section: 'Коллекции' },
  generateSequence: { kind: 'fun', signature: 'fun <T : Any> generateSequence(nextFunction: () -> T?): Sequence<T>', returnType: 'Sequence<T>', description: 'Создает последовательность, генерируя следующий элемент по функции.', section: 'Коллекции' },
  emptyList: { kind: 'fun', signature: 'fun <T> emptyList(): List<T>', returnType: 'List<T>', description: 'Возвращает пустой read-only список.', section: 'Коллекции' },
  emptySet: { kind: 'fun', signature: 'fun <T> emptySet(): Set<T>', returnType: 'Set<T>', description: 'Возвращает пустое read-only множество.', section: 'Коллекции' },
  emptyMap: { kind: 'fun', signature: 'fun <K, V> emptyMap(): Map<K, V>', returnType: 'Map<K, V>', description: 'Возвращает пустой read-only словарь.', section: 'Коллекции' },
  buildList: { kind: 'fun', signature: 'fun <E> buildList(builderAction: MutableList<E>.() -> Unit): List<E>', returnType: 'List<E>', description: 'Строит read-only List через временный MutableList receiver.', section: 'Коллекции' },
  buildSet: { kind: 'fun', signature: 'fun <E> buildSet(builderAction: MutableSet<E>.() -> Unit): Set<E>', returnType: 'Set<E>', description: 'Строит read-only Set через временный MutableSet receiver.', section: 'Коллекции' },
  buildMap: { kind: 'fun', signature: 'fun <K, V> buildMap(builderAction: MutableMap<K, V>.() -> Unit): Map<K, V>', returnType: 'Map<K, V>', description: 'Строит read-only Map через временный MutableMap receiver.', section: 'Коллекции' },
}

const kotlinStdlibCompletions: Completion[] = Object.entries(kotlinStdlibDocs).map(([label, doc]) => ({
  label,
  type: completionType(doc.kind),
  detail: doc.signature,
  info: `${doc.signature}\n${doc.description}`,
  section: doc.section,
}))

const kotlinLanguageDocs: Record<string, KotlinStdlibDoc> = {
  val: { kind: 'keyword', signature: 'val name: Type = value', description: 'Объявляет read-only ссылку. Сам объект может быть mutable, но переменную нельзя переназначить.', section: 'Язык' },
  var: { kind: 'keyword', signature: 'var name: Type = value', description: 'Объявляет изменяемую переменную, которую можно переназначить.', section: 'Язык' },
  fun: { kind: 'keyword', signature: 'fun name(parameters): ReturnType', description: 'Объявляет функцию. Тип результата можно опустить, если он выводится из expression body.', section: 'Язык' },
  class: { kind: 'keyword', signature: 'class Name(...) { ... }', description: 'Объявляет класс: состояние, поведение, конструкторы, свойства и методы.', section: 'Язык' },
  interface: { kind: 'keyword', signature: 'interface Name { ... }', description: 'Контракт типа. Может содержать abstract members и реализации по умолчанию.', section: 'Язык' },
  object: { kind: 'keyword', signature: 'object Name { ... }', description: 'Singleton-объект: ровно один экземпляр, создается лениво при первом обращении.', section: 'Язык' },
  data: { kind: 'modifier', signature: 'data class Name(...)', description: 'Модификатор data class: генерирует equals/hashCode/toString/copy/componentN по constructor properties.', section: 'Язык' },
  sealed: { kind: 'modifier', signature: 'sealed class/interface Name', description: 'Закрытая иерархия: все прямые наследники известны компилятору, удобно для exhaustive when.', section: 'Язык' },
  enum: { kind: 'modifier', signature: 'enum class Name', description: 'Класс с фиксированным набором экземпляров-констант.', section: 'Язык' },
  when: { kind: 'keyword', signature: 'when (value) { condition -> result }', description: 'Мощная замена switch: работает как statement или expression, поддерживает типы, ranges и условия.', section: 'Язык' },
  if: { kind: 'keyword', signature: 'if (condition) value else fallback', description: 'Условная конструкция. В Kotlin if может быть expression и возвращать значение.', section: 'Язык' },
  for: { kind: 'keyword', signature: 'for (item in items) { ... }', description: 'Цикл по Iterable, массиву, range или progression.', section: 'Язык' },
  while: { kind: 'keyword', signature: 'while (condition) { ... }', description: 'Цикл, который выполняется, пока условие истинно.', section: 'Язык' },
  try: { kind: 'keyword', signature: 'try { ... } catch (e: Exception) { ... }', description: 'Обработка исключений. В Kotlin try тоже может быть expression.', section: 'Язык' },
  catch: { kind: 'keyword', signature: 'catch (e: Throwable) { ... }', description: 'Ветка обработки исключения из блока try.', section: 'Язык' },
  finally: { kind: 'keyword', signature: 'finally { ... }', description: 'Блок, который выполняется после try/catch независимо от результата.', section: 'Язык' },
  return: { kind: 'keyword', signature: 'return value', description: 'Завершает функцию и возвращает значение.', section: 'Язык' },
  throw: { kind: 'keyword', signature: 'throw exception', description: 'Бросает исключение. Выражение throw имеет тип Nothing.', section: 'Язык' },
  null: { kind: 'keyword', signature: 'null', description: 'Отсутствие значения. Может быть присвоено только nullable-типам вроде String?.', section: 'Язык' },
  true: { kind: 'literal', signature: 'true', description: 'Логический литерал Boolean со значением истина.', section: 'Язык' },
  false: { kind: 'literal', signature: 'false', description: 'Логический литерал Boolean со значением ложь.', section: 'Язык' },
  is: { kind: 'keyword', signature: 'value is Type', description: 'Проверяет тип и часто включает smart cast внутри ветки.', section: 'Язык' },
  as: { kind: 'keyword', signature: 'value as Type', description: 'Явное приведение типа. Для безопасного приведения используйте as?.', section: 'Язык' },
  in: { kind: 'keyword', signature: 'value in range', description: 'Проверка contains или часть for-loop: for (x in xs).', section: 'Язык' },
}

const kotlinKeywordCompletions: Completion[] = kotlinKeywords.map((keyword) => {
  const doc = kotlinLanguageDocs[keyword]

  return {
    label: keyword,
    type: 'keyword',
    detail: doc?.signature ?? 'keyword',
    info: doc ? `${doc.signature}\n${doc.description}` : 'Kotlin keyword',
    section: 'Keywords',
  }
})

const commonAnyMembers: KotlinMemberInfo[] = [
  {
    label: 'toString',
    type: 'method',
    signature: 'fun toString(): String',
    returnType: 'String',
    section: 'Any',
    boost: 20,
  },
  {
    label: 'hashCode',
    type: 'method',
    signature: 'fun hashCode(): Int',
    returnType: 'Int',
    section: 'Any',
    boost: 18,
  },
  {
    label: 'equals',
    type: 'method',
    signature: 'fun equals(other: Any?): Boolean',
    returnType: 'Boolean',
    section: 'Any',
    boost: 18,
  },
]

const commonScopeMembers: KotlinMemberInfo[] = [
  {
    label: 'let',
    type: 'method',
    signature: 'inline fun <T, R> T.let(block: (T) -> R): R',
    returnType: 'R',
    section: 'Scope functions',
    boost: 38,
  },
  {
    label: 'also',
    type: 'method',
    signature: 'inline fun <T> T.also(block: (T) -> Unit): T',
    returnType: 'T',
    section: 'Scope functions',
    boost: 36,
  },
  {
    label: 'apply',
    type: 'method',
    signature: 'inline fun <T> T.apply(block: T.() -> Unit): T',
    returnType: 'T',
    section: 'Scope functions',
    boost: 36,
  },
  {
    label: 'run',
    type: 'method',
    signature: 'inline fun <T, R> T.run(block: T.() -> R): R',
    returnType: 'R',
    section: 'Scope functions',
    boost: 34,
  },
  {
    label: 'takeIf',
    type: 'method',
    signature: 'inline fun <T> T.takeIf(predicate: (T) -> Boolean): T?',
    returnType: 'T?',
    section: 'Scope functions',
    boost: 32,
  },
  {
    label: 'takeUnless',
    type: 'method',
    signature: 'inline fun <T> T.takeUnless(predicate: (T) -> Boolean): T?',
    returnType: 'T?',
    section: 'Scope functions',
    boost: 31,
  },
]

const collectionReadMembers: KotlinMemberInfo[] = [
  { label: 'size', type: 'property', signature: 'val size: Int', returnType: 'Int', section: 'Collection', boost: 130 },
  { label: 'indices', type: 'property', signature: 'val indices: IntRange', returnType: 'IntRange', section: 'Collection', boost: 118 },
  { label: 'lastIndex', type: 'property', signature: 'val lastIndex: Int', returnType: 'Int', section: 'Collection', boost: 118 },
  { label: 'isEmpty', type: 'method', signature: 'fun isEmpty(): Boolean', returnType: 'Boolean', section: 'Collection', boost: 116 },
  { label: 'isNotEmpty', type: 'method', signature: 'fun isNotEmpty(): Boolean', returnType: 'Boolean', section: 'Collection', boost: 116 },
  { label: 'iterator', type: 'method', signature: 'operator fun iterator(): Iterator<T>', returnType: 'Iterator<T>', section: 'Iteration', boost: 78 },
  { label: 'contains', type: 'method', signature: 'operator fun contains(element: T): Boolean', returnType: 'Boolean', section: 'Collection', boost: 100 },
  { label: 'containsAll', type: 'method', signature: 'fun containsAll(elements: Collection<T>): Boolean', returnType: 'Boolean', section: 'Collection', boost: 82 },
  { label: 'get', type: 'method', signature: 'operator fun get(index: Int): T', returnType: 'T', section: 'Indexed access', boost: 106 },
  { label: 'elementAt', type: 'method', signature: 'fun elementAt(index: Int): T', returnType: 'T', section: 'Indexed access', boost: 84 },
  { label: 'elementAtOrNull', type: 'method', signature: 'fun elementAtOrNull(index: Int): T?', returnType: 'T?', section: 'Indexed access', boost: 80 },
  { label: 'elementAtOrElse', type: 'method', signature: 'fun elementAtOrElse(index: Int, defaultValue: (Int) -> T): T', returnType: 'T', section: 'Indexed access', boost: 78 },
  { label: 'indexOf', type: 'method', signature: 'fun indexOf(element: T): Int', returnType: 'Int', section: 'Indexed access', boost: 82 },
  { label: 'lastIndexOf', type: 'method', signature: 'fun lastIndexOf(element: T): Int', returnType: 'Int', section: 'Indexed access', boost: 78 },
  { label: 'first', type: 'method', signature: 'fun first(): T', returnType: 'T', section: 'Collection', boost: 110 },
  { label: 'firstOrNull', type: 'method', signature: 'fun firstOrNull(): T?', returnType: 'T?', section: 'Collection', boost: 106 },
  { label: 'find', type: 'method', signature: 'fun find(predicate: (T) -> Boolean): T?', returnType: 'T?', section: 'Predicate', boost: 98 },
  { label: 'last', type: 'method', signature: 'fun last(): T', returnType: 'T', section: 'Collection', boost: 104 },
  { label: 'lastOrNull', type: 'method', signature: 'fun lastOrNull(): T?', returnType: 'T?', section: 'Collection', boost: 102 },
  { label: 'findLast', type: 'method', signature: 'fun findLast(predicate: (T) -> Boolean): T?', returnType: 'T?', section: 'Predicate', boost: 82 },
  { label: 'single', type: 'method', signature: 'fun single(): T', returnType: 'T', section: 'Collection', boost: 72 },
  { label: 'singleOrNull', type: 'method', signature: 'fun singleOrNull(): T?', returnType: 'T?', section: 'Collection', boost: 70 },
  { label: 'map', type: 'method', signature: 'fun <R> map(transform: (T) -> R): List<R>', returnType: 'List<R>', section: 'Transform', boost: 126 },
  { label: 'mapIndexed', type: 'method', signature: 'fun <R> mapIndexed(transform: (index: Int, T) -> R): List<R>', returnType: 'List<R>', section: 'Transform', boost: 104 },
  { label: 'mapNotNull', type: 'method', signature: 'fun <R : Any> mapNotNull(transform: (T) -> R?): List<R>', returnType: 'List<R>', section: 'Transform', boost: 100 },
  { label: 'flatMap', type: 'method', signature: 'fun <R> flatMap(transform: (T) -> Iterable<R>): List<R>', returnType: 'List<R>', section: 'Transform', boost: 102 },
  { label: 'filter', type: 'method', signature: 'fun filter(predicate: (T) -> Boolean): List<T>', returnType: 'List<T>', section: 'Filter', boost: 124 },
  { label: 'filterIndexed', type: 'method', signature: 'fun filterIndexed(predicate: (index: Int, T) -> Boolean): List<T>', returnType: 'List<T>', section: 'Filter', boost: 98 },
  { label: 'filterNot', type: 'method', signature: 'fun filterNot(predicate: (T) -> Boolean): List<T>', returnType: 'List<T>', section: 'Filter', boost: 96 },
  { label: 'filterNotNull', type: 'method', signature: 'fun filterNotNull(): List<T>', returnType: 'List<T>', section: 'Filter', boost: 86 },
  { label: 'forEach', type: 'method', signature: 'fun forEach(action: (T) -> Unit): Unit', returnType: 'Unit', section: 'Iteration', boost: 112 },
  { label: 'forEachIndexed', type: 'method', signature: 'fun forEachIndexed(action: (index: Int, T) -> Unit): Unit', returnType: 'Unit', section: 'Iteration', boost: 92 },
  { label: 'onEach', type: 'method', signature: 'fun onEach(action: (T) -> Unit): Iterable<T>', returnType: 'Iterable<T>', section: 'Iteration', boost: 86 },
  { label: 'fold', type: 'method', signature: 'fun <R> fold(initial: R, operation: (acc: R, T) -> R): R', returnType: 'R', section: 'Aggregate', boost: 92 },
  { label: 'foldIndexed', type: 'method', signature: 'fun <R> foldIndexed(initial: R, operation: (index: Int, acc: R, T) -> R): R', returnType: 'R', section: 'Aggregate', boost: 76 },
  { label: 'reduce', type: 'method', signature: 'fun reduce(operation: (acc: T, T) -> T): T', returnType: 'T', section: 'Aggregate', boost: 90 },
  { label: 'reduceOrNull', type: 'method', signature: 'fun reduceOrNull(operation: (acc: T, T) -> T): T?', returnType: 'T?', section: 'Aggregate', boost: 78 },
  { label: 'groupBy', type: 'method', signature: 'fun <K> groupBy(keySelector: (T) -> K): Map<K, List<T>>', returnType: 'Map<K, List<T>>', section: 'Transform', boost: 94 },
  { label: 'associateBy', type: 'method', signature: 'fun <K> associateBy(keySelector: (T) -> K): Map<K, T>', returnType: 'Map<K, T>', section: 'Transform', boost: 90 },
  { label: 'associateWith', type: 'method', signature: 'fun <V> associateWith(valueSelector: (T) -> V): Map<T, V>', returnType: 'Map<T, V>', section: 'Transform', boost: 86 },
  { label: 'partition', type: 'method', signature: 'fun partition(predicate: (T) -> Boolean): Pair<List<T>, List<T>>', returnType: 'Pair<List<T>, List<T>>', section: 'Filter', boost: 84 },
  { label: 'sorted', type: 'method', signature: 'fun sorted(): List<T>', returnType: 'List<T>', section: 'Order', boost: 92 },
  { label: 'sortedDescending', type: 'method', signature: 'fun sortedDescending(): List<T>', returnType: 'List<T>', section: 'Order', boost: 86 },
  { label: 'sortedBy', type: 'method', signature: 'fun <R : Comparable<R>> sortedBy(selector: (T) -> R?): List<T>', returnType: 'List<T>', section: 'Order', boost: 96 },
  { label: 'sortedByDescending', type: 'method', signature: 'fun <R : Comparable<R>> sortedByDescending(selector: (T) -> R?): List<T>', returnType: 'List<T>', section: 'Order', boost: 86 },
  { label: 'reversed', type: 'method', signature: 'fun reversed(): List<T>', returnType: 'List<T>', section: 'Order', boost: 84 },
  { label: 'shuffled', type: 'method', signature: 'fun shuffled(): List<T>', returnType: 'List<T>', section: 'Order', boost: 72 },
  { label: 'distinct', type: 'method', signature: 'fun distinct(): List<T>', returnType: 'List<T>', section: 'Transform', boost: 88 },
  { label: 'distinctBy', type: 'method', signature: 'fun <K> distinctBy(selector: (T) -> K): List<T>', returnType: 'List<T>', section: 'Transform', boost: 78 },
  { label: 'joinToString', type: 'method', signature: 'fun joinToString(separator: String = ", "): String', returnType: 'String', section: 'Transform', boost: 94 },
  { label: 'take', type: 'method', signature: 'fun take(n: Int): List<T>', returnType: 'List<T>', section: 'Slice', boost: 84 },
  { label: 'takeLast', type: 'method', signature: 'fun takeLast(n: Int): List<T>', returnType: 'List<T>', section: 'Slice', boost: 76 },
  { label: 'takeWhile', type: 'method', signature: 'fun takeWhile(predicate: (T) -> Boolean): List<T>', returnType: 'List<T>', section: 'Slice', boost: 74 },
  { label: 'drop', type: 'method', signature: 'fun drop(n: Int): List<T>', returnType: 'List<T>', section: 'Slice', boost: 82 },
  { label: 'dropLast', type: 'method', signature: 'fun dropLast(n: Int): List<T>', returnType: 'List<T>', section: 'Slice', boost: 74 },
  { label: 'slice', type: 'method', signature: 'fun slice(indices: Iterable<Int>): List<T>', returnType: 'List<T>', section: 'Slice', boost: 74 },
  { label: 'zip', type: 'method', signature: 'fun <R> zip(other: Iterable<R>): List<Pair<T, R>>', returnType: 'List<Pair<T, R>>', section: 'Transform', boost: 80 },
  { label: 'any', type: 'method', signature: 'fun any(predicate: (T) -> Boolean): Boolean', returnType: 'Boolean', section: 'Predicate', boost: 92 },
  { label: 'all', type: 'method', signature: 'fun all(predicate: (T) -> Boolean): Boolean', returnType: 'Boolean', section: 'Predicate', boost: 90 },
  { label: 'none', type: 'method', signature: 'fun none(predicate: (T) -> Boolean): Boolean', returnType: 'Boolean', section: 'Predicate', boost: 88 },
  { label: 'random', type: 'method', signature: 'fun random(): T', returnType: 'T', section: 'Collection', boost: 72 },
  { label: 'count', type: 'method', signature: 'fun count(predicate: (T) -> Boolean): Int', returnType: 'Int', section: 'Aggregate', boost: 90 },
  { label: 'sumOf', type: 'method', signature: 'fun <R> sumOf(selector: (T) -> R): R', returnType: 'R', section: 'Aggregate', boost: 84 },
  { label: 'minOrNull', type: 'method', signature: 'fun minOrNull(): T?', returnType: 'T?', section: 'Aggregate', boost: 76 },
  { label: 'maxOrNull', type: 'method', signature: 'fun maxOrNull(): T?', returnType: 'T?', section: 'Aggregate', boost: 76 },
  { label: 'toList', type: 'method', signature: 'fun toList(): List<T>', returnType: 'List<T>', section: 'Convert', boost: 88 },
  { label: 'toMutableList', type: 'method', signature: 'fun toMutableList(): MutableList<T>', returnType: 'MutableList<T>', section: 'Convert', boost: 84 },
  { label: 'toSet', type: 'method', signature: 'fun toSet(): Set<T>', returnType: 'Set<T>', section: 'Convert', boost: 82 },
  { label: 'toMutableSet', type: 'method', signature: 'fun toMutableSet(): MutableSet<T>', returnType: 'MutableSet<T>', section: 'Convert', boost: 80 },
  { label: 'asSequence', type: 'method', signature: 'fun asSequence(): Sequence<T>', returnType: 'Sequence<T>', section: 'Convert', boost: 82 },
  { label: 'asIterable', type: 'method', signature: 'fun asIterable(): Iterable<T>', returnType: 'Iterable<T>', section: 'Convert', boost: 70 },
  { label: 'chunked', type: 'method', signature: 'fun chunked(size: Int): List<List<T>>', returnType: 'List<List<T>>', section: 'Transform', boost: 72 },
  { label: 'windowed', type: 'method', signature: 'fun windowed(size: Int, step: Int = 1): List<List<T>>', returnType: 'List<List<T>>', section: 'Transform', boost: 70 },
  { label: 'plus', type: 'method', signature: 'operator fun plus(element: T): List<T>', returnType: 'List<T>', section: 'Operators', boost: 66 },
  { label: 'minus', type: 'method', signature: 'operator fun minus(element: T): List<T>', returnType: 'List<T>', section: 'Operators', boost: 66 },
]

const mutableListMembers: KotlinMemberInfo[] = [
  { label: 'add', type: 'method', signature: 'fun add(element: T): Boolean', returnType: 'Boolean', section: 'MutableList', boost: 128 },
  { label: 'addAll', type: 'method', signature: 'fun addAll(elements: Collection<T>): Boolean', returnType: 'Boolean', section: 'MutableList', boost: 104 },
  { label: 'remove', type: 'method', signature: 'fun remove(element: T): Boolean', returnType: 'Boolean', section: 'MutableList', boost: 104 },
  { label: 'removeAt', type: 'method', signature: 'fun removeAt(index: Int): T', returnType: 'T', section: 'MutableList', boost: 96 },
  { label: 'removeAll', type: 'method', signature: 'fun removeAll(elements: Collection<T>): Boolean', returnType: 'Boolean', section: 'MutableList', boost: 82 },
  { label: 'clear', type: 'method', signature: 'fun clear(): Unit', returnType: 'Unit', section: 'MutableList', boost: 94 },
  { label: 'set', type: 'method', signature: 'operator fun set(index: Int, element: T): T', returnType: 'T', section: 'MutableList', boost: 100 },
  { label: 'fill', type: 'method', signature: 'fun fill(value: T): Unit', returnType: 'Unit', section: 'MutableList', boost: 78 },
  { label: 'replaceAll', type: 'method', signature: 'fun replaceAll(transform: (T) -> T): Unit', returnType: 'Unit', section: 'MutableList', boost: 72 },
  { label: 'sort', type: 'method', signature: 'fun sort(): Unit', returnType: 'Unit', section: 'MutableList', boost: 82 },
  { label: 'sortBy', type: 'method', signature: 'fun <R : Comparable<R>> sortBy(selector: (T) -> R?): Unit', returnType: 'Unit', section: 'MutableList', boost: 78 },
  { label: 'sortDescending', type: 'method', signature: 'fun sortDescending(): Unit', returnType: 'Unit', section: 'MutableList', boost: 74 },
  { label: 'shuffle', type: 'method', signature: 'fun shuffle(): Unit', returnType: 'Unit', section: 'MutableList', boost: 70 },
]

const setMembers: KotlinMemberInfo[] = collectionReadMembers.filter(
  (member) => !['get', 'indices', 'lastIndex', 'indexOf', 'lastIndexOf', 'elementAt', 'elementAtOrNull', 'elementAtOrElse'].includes(member.label),
)

const mutableSetMembers: KotlinMemberInfo[] = [
  { label: 'add', type: 'method', signature: 'fun add(element: T): Boolean', returnType: 'Boolean', section: 'MutableSet', boost: 128 },
  { label: 'addAll', type: 'method', signature: 'fun addAll(elements: Collection<T>): Boolean', returnType: 'Boolean', section: 'MutableSet', boost: 104 },
  { label: 'remove', type: 'method', signature: 'fun remove(element: T): Boolean', returnType: 'Boolean', section: 'MutableSet', boost: 104 },
  { label: 'removeAll', type: 'method', signature: 'fun removeAll(elements: Collection<T>): Boolean', returnType: 'Boolean', section: 'MutableSet', boost: 82 },
  { label: 'clear', type: 'method', signature: 'fun clear(): Unit', returnType: 'Unit', section: 'MutableSet', boost: 94 },
]

const mapMembers: KotlinMemberInfo[] = [
  { label: 'size', type: 'property', signature: 'val size: Int', returnType: 'Int', section: 'Map', boost: 130 },
  { label: 'keys', type: 'property', signature: 'val keys: Set<K>', returnType: 'Set<K>', section: 'Map', boost: 120 },
  { label: 'values', type: 'property', signature: 'val values: Collection<V>', returnType: 'Collection<V>', section: 'Map', boost: 118 },
  { label: 'entries', type: 'property', signature: 'val entries: Set<Map.Entry<K, V>>', returnType: 'Set<Map.Entry<K, V>>', section: 'Map', boost: 116 },
  { label: 'isEmpty', type: 'method', signature: 'fun isEmpty(): Boolean', returnType: 'Boolean', section: 'Map', boost: 112 },
  { label: 'isNotEmpty', type: 'method', signature: 'fun isNotEmpty(): Boolean', returnType: 'Boolean', section: 'Map', boost: 112 },
  { label: 'containsKey', type: 'method', signature: 'fun containsKey(key: K): Boolean', returnType: 'Boolean', section: 'Map', boost: 110 },
  { label: 'containsValue', type: 'method', signature: 'fun containsValue(value: V): Boolean', returnType: 'Boolean', section: 'Map', boost: 104 },
  { label: 'get', type: 'method', signature: 'operator fun get(key: K): V?', returnType: 'V?', section: 'Map', boost: 108 },
  { label: 'getValue', type: 'method', signature: 'fun getValue(key: K): V', returnType: 'V', section: 'Map', boost: 98 },
  { label: 'getOrDefault', type: 'method', signature: 'fun getOrDefault(key: K, defaultValue: V): V', returnType: 'V', section: 'Map', boost: 92 },
  { label: 'getOrElse', type: 'method', signature: 'fun getOrElse(key: K, defaultValue: () -> V): V', returnType: 'V', section: 'Map', boost: 92 },
  { label: 'map', type: 'method', signature: 'fun <R> map(transform: (Map.Entry<K, V>) -> R): List<R>', returnType: 'List<R>', section: 'Transform', boost: 106 },
  { label: 'mapKeys', type: 'method', signature: 'fun <R> mapKeys(transform: (Map.Entry<K, V>) -> R): Map<R, V>', returnType: 'Map<R, V>', section: 'Transform', boost: 102 },
  { label: 'mapValues', type: 'method', signature: 'fun <R> mapValues(transform: (Map.Entry<K, V>) -> R): Map<K, R>', returnType: 'Map<K, R>', section: 'Transform', boost: 104 },
  { label: 'filter', type: 'method', signature: 'fun filter(predicate: (Map.Entry<K, V>) -> Boolean): Map<K, V>', returnType: 'Map<K, V>', section: 'Filter', boost: 106 },
  { label: 'filterKeys', type: 'method', signature: 'fun filterKeys(predicate: (K) -> Boolean): Map<K, V>', returnType: 'Map<K, V>', section: 'Filter', boost: 98 },
  { label: 'filterValues', type: 'method', signature: 'fun filterValues(predicate: (V) -> Boolean): Map<K, V>', returnType: 'Map<K, V>', section: 'Filter', boost: 98 },
  { label: 'forEach', type: 'method', signature: 'fun forEach(action: (K, V) -> Unit): Unit', returnType: 'Unit', section: 'Iteration', boost: 100 },
  { label: 'toMap', type: 'method', signature: 'fun toMap(): Map<K, V>', returnType: 'Map<K, V>', section: 'Convert', boost: 86 },
  { label: 'toMutableMap', type: 'method', signature: 'fun toMutableMap(): MutableMap<K, V>', returnType: 'MutableMap<K, V>', section: 'Convert', boost: 84 },
  { label: 'plus', type: 'method', signature: 'operator fun plus(pair: Pair<K, V>): Map<K, V>', returnType: 'Map<K, V>', section: 'Operators', boost: 72 },
  { label: 'minus', type: 'method', signature: 'operator fun minus(key: K): Map<K, V>', returnType: 'Map<K, V>', section: 'Operators', boost: 72 },
]

const mutableMapMembers: KotlinMemberInfo[] = [
  { label: 'put', type: 'method', signature: 'fun put(key: K, value: V): V?', returnType: 'V?', section: 'MutableMap', boost: 128 },
  { label: 'putAll', type: 'method', signature: 'fun putAll(from: Map<K, V>): Unit', returnType: 'Unit', section: 'MutableMap', boost: 100 },
  { label: 'remove', type: 'method', signature: 'fun remove(key: K): V?', returnType: 'V?', section: 'MutableMap', boost: 104 },
  { label: 'clear', type: 'method', signature: 'fun clear(): Unit', returnType: 'Unit', section: 'MutableMap', boost: 94 },
  { label: 'getOrPut', type: 'method', signature: 'fun getOrPut(key: K, defaultValue: () -> V): V', returnType: 'V', section: 'MutableMap', boost: 96 },
]

const mapEntryMembers: KotlinMemberInfo[] = [
  { label: 'key', type: 'property', signature: 'val key: K', returnType: 'K', section: 'Map.Entry', boost: 126 },
  { label: 'value', type: 'property', signature: 'val value: V', returnType: 'V', section: 'Map.Entry', boost: 126 },
  { label: 'component1', type: 'method', signature: 'operator fun component1(): K', returnType: 'K', section: 'Map.Entry', boost: 82 },
  { label: 'component2', type: 'method', signature: 'operator fun component2(): V', returnType: 'V', section: 'Map.Entry', boost: 82 },
  { label: 'toPair', type: 'method', signature: 'fun toPair(): Pair<K, V>', returnType: 'Pair<K, V>', section: 'Map.Entry', boost: 74 },
]

const stringMembers: KotlinMemberInfo[] = [
  { label: 'length', type: 'property', signature: 'val length: Int', returnType: 'Int', section: 'String', boost: 132 },
  { label: 'indices', type: 'property', signature: 'val indices: IntRange', returnType: 'IntRange', section: 'String', boost: 116 },
  { label: 'lastIndex', type: 'property', signature: 'val lastIndex: Int', returnType: 'Int', section: 'String', boost: 116 },
  { label: 'isEmpty', type: 'method', signature: 'fun isEmpty(): Boolean', returnType: 'Boolean', section: 'String', boost: 116 },
  { label: 'isNotEmpty', type: 'method', signature: 'fun isNotEmpty(): Boolean', returnType: 'Boolean', section: 'String', boost: 116 },
  { label: 'isBlank', type: 'method', signature: 'fun isBlank(): Boolean', returnType: 'Boolean', section: 'String', boost: 114 },
  { label: 'isNotBlank', type: 'method', signature: 'fun isNotBlank(): Boolean', returnType: 'Boolean', section: 'String', boost: 114 },
  { label: 'get', type: 'method', signature: 'operator fun get(index: Int): Char', returnType: 'Char', section: 'String', boost: 98 },
  { label: 'substring', type: 'method', signature: 'fun substring(startIndex: Int, endIndex: Int = length): String', returnType: 'String', section: 'String', boost: 110 },
  { label: 'contains', type: 'method', signature: 'fun contains(other: CharSequence, ignoreCase: Boolean = false): Boolean', returnType: 'Boolean', section: 'String', boost: 106 },
  { label: 'indexOf', type: 'method', signature: 'fun indexOf(string: String, startIndex: Int = 0, ignoreCase: Boolean = false): Int', returnType: 'Int', section: 'String', boost: 92 },
  { label: 'lastIndexOf', type: 'method', signature: 'fun lastIndexOf(string: String, startIndex: Int = lastIndex, ignoreCase: Boolean = false): Int', returnType: 'Int', section: 'String', boost: 82 },
  { label: 'startsWith', type: 'method', signature: 'fun startsWith(prefix: String, ignoreCase: Boolean = false): Boolean', returnType: 'Boolean', section: 'String', boost: 96 },
  { label: 'endsWith', type: 'method', signature: 'fun endsWith(suffix: String, ignoreCase: Boolean = false): Boolean', returnType: 'Boolean', section: 'String', boost: 96 },
  { label: 'lowercase', type: 'method', signature: 'fun lowercase(): String', returnType: 'String', section: 'String', boost: 102 },
  { label: 'uppercase', type: 'method', signature: 'fun uppercase(): String', returnType: 'String', section: 'String', boost: 102 },
  { label: 'trim', type: 'method', signature: 'fun trim(): String', returnType: 'String', section: 'String', boost: 102 },
  { label: 'trimStart', type: 'method', signature: 'fun trimStart(): String', returnType: 'String', section: 'String', boost: 84 },
  { label: 'trimEnd', type: 'method', signature: 'fun trimEnd(): String', returnType: 'String', section: 'String', boost: 84 },
  { label: 'split', type: 'method', signature: 'fun split(vararg delimiters: String): List<String>', returnType: 'List<String>', section: 'String', boost: 102 },
  { label: 'replace', type: 'method', signature: 'fun replace(oldValue: String, newValue: String, ignoreCase: Boolean = false): String', returnType: 'String', section: 'String', boost: 100 },
  { label: 'replaceFirst', type: 'method', signature: 'fun replaceFirst(oldValue: String, newValue: String, ignoreCase: Boolean = false): String', returnType: 'String', section: 'String', boost: 78 },
  { label: 'removePrefix', type: 'method', signature: 'fun removePrefix(prefix: CharSequence): String', returnType: 'String', section: 'String', boost: 82 },
  { label: 'removeSuffix', type: 'method', signature: 'fun removeSuffix(suffix: CharSequence): String', returnType: 'String', section: 'String', boost: 82 },
  { label: 'removeSurrounding', type: 'method', signature: 'fun removeSurrounding(prefix: CharSequence, suffix: CharSequence): String', returnType: 'String', section: 'String', boost: 76 },
  { label: 'padStart', type: 'method', signature: 'fun padStart(length: Int, padChar: Char = \' \'): String', returnType: 'String', section: 'String', boost: 72 },
  { label: 'padEnd', type: 'method', signature: 'fun padEnd(length: Int, padChar: Char = \' \'): String', returnType: 'String', section: 'String', boost: 72 },
  { label: 'lines', type: 'method', signature: 'fun lines(): List<String>', returnType: 'List<String>', section: 'String', boost: 76 },
  { label: 'filter', type: 'method', signature: 'fun filter(predicate: (Char) -> Boolean): String', returnType: 'String', section: 'String', boost: 92 },
  { label: 'filterNot', type: 'method', signature: 'fun filterNot(predicate: (Char) -> Boolean): String', returnType: 'String', section: 'String', boost: 82 },
  { label: 'map', type: 'method', signature: 'fun <R> map(transform: (Char) -> R): List<R>', returnType: 'List<R>', section: 'String', boost: 88 },
  { label: 'forEach', type: 'method', signature: 'fun forEach(action: (Char) -> Unit): Unit', returnType: 'Unit', section: 'String', boost: 84 },
  { label: 'any', type: 'method', signature: 'fun any(predicate: (Char) -> Boolean): Boolean', returnType: 'Boolean', section: 'String', boost: 80 },
  { label: 'all', type: 'method', signature: 'fun all(predicate: (Char) -> Boolean): Boolean', returnType: 'Boolean', section: 'String', boost: 78 },
  { label: 'none', type: 'method', signature: 'fun none(predicate: (Char) -> Boolean): Boolean', returnType: 'Boolean', section: 'String', boost: 76 },
  { label: 'count', type: 'method', signature: 'fun count(predicate: (Char) -> Boolean): Int', returnType: 'Int', section: 'String', boost: 76 },
  { label: 'find', type: 'method', signature: 'fun find(predicate: (Char) -> Boolean): Char?', returnType: 'Char?', section: 'String', boost: 74 },
  { label: 'matches', type: 'method', signature: 'fun matches(regex: Regex): Boolean', returnType: 'Boolean', section: 'String', boost: 70 },
  { label: 'toRegex', type: 'method', signature: 'fun toRegex(): Regex', returnType: 'Regex', section: 'Convert', boost: 68 },
  { label: 'toInt', type: 'method', signature: 'fun toInt(): Int', returnType: 'Int', section: 'Convert', boost: 94 },
  { label: 'toIntOrNull', type: 'method', signature: 'fun toIntOrNull(): Int?', returnType: 'Int?', section: 'Convert', boost: 92 },
  { label: 'toLong', type: 'method', signature: 'fun toLong(): Long', returnType: 'Long', section: 'Convert', boost: 84 },
  { label: 'toDouble', type: 'method', signature: 'fun toDouble(): Double', returnType: 'Double', section: 'Convert', boost: 84 },
  { label: 'toBoolean', type: 'method', signature: 'fun toBoolean(): Boolean', returnType: 'Boolean', section: 'Convert', boost: 70 },
]

const numberMembers: KotlinMemberInfo[] = [
  { label: 'toByte', type: 'method', signature: 'fun toByte(): Byte', returnType: 'Byte', section: 'Number', boost: 76 },
  { label: 'toShort', type: 'method', signature: 'fun toShort(): Short', returnType: 'Short', section: 'Number', boost: 76 },
  { label: 'toInt', type: 'method', signature: 'fun toInt(): Int', returnType: 'Int', section: 'Number', boost: 100 },
  { label: 'toLong', type: 'method', signature: 'fun toLong(): Long', returnType: 'Long', section: 'Number', boost: 100 },
  { label: 'toFloat', type: 'method', signature: 'fun toFloat(): Float', returnType: 'Float', section: 'Number', boost: 96 },
  { label: 'toDouble', type: 'method', signature: 'fun toDouble(): Double', returnType: 'Double', section: 'Number', boost: 96 },
  { label: 'coerceAtLeast', type: 'method', signature: 'fun coerceAtLeast(minimumValue: T): T', returnType: 'T', section: 'Number', boost: 92 },
  { label: 'coerceAtMost', type: 'method', signature: 'fun coerceAtMost(maximumValue: T): T', returnType: 'T', section: 'Number', boost: 92 },
  { label: 'coerceIn', type: 'method', signature: 'fun coerceIn(minimumValue: T, maximumValue: T): T', returnType: 'T', section: 'Number', boost: 90 },
  { label: 'compareTo', type: 'method', signature: 'operator fun compareTo(other: T): Int', returnType: 'Int', section: 'Number', boost: 76 },
  { label: 'plus', type: 'method', signature: 'operator fun plus(other: T): T', returnType: 'T', section: 'Operators', boost: 70 },
  { label: 'minus', type: 'method', signature: 'operator fun minus(other: T): T', returnType: 'T', section: 'Operators', boost: 70 },
  { label: 'times', type: 'method', signature: 'operator fun times(other: T): T', returnType: 'T', section: 'Operators', boost: 70 },
  { label: 'div', type: 'method', signature: 'operator fun div(other: T): T', returnType: 'T', section: 'Operators', boost: 70 },
  { label: 'rem', type: 'method', signature: 'operator fun rem(other: T): T', returnType: 'T', section: 'Operators', boost: 68 },
  { label: 'rangeTo', type: 'method', signature: 'operator fun rangeTo(other: T): ClosedRange<T>', returnType: 'ClosedRange<T>', section: 'Operators', boost: 64 },
  { label: 'toString', type: 'method', signature: 'fun toString(): String', returnType: 'String', section: 'Number', boost: 62 },
]

const booleanMembers: KotlinMemberInfo[] = [
  { label: 'and', type: 'method', signature: 'infix fun and(other: Boolean): Boolean', returnType: 'Boolean', section: 'Boolean', boost: 92 },
  { label: 'or', type: 'method', signature: 'infix fun or(other: Boolean): Boolean', returnType: 'Boolean', section: 'Boolean', boost: 92 },
  { label: 'xor', type: 'method', signature: 'infix fun xor(other: Boolean): Boolean', returnType: 'Boolean', section: 'Boolean', boost: 86 },
  { label: 'not', type: 'method', signature: 'operator fun not(): Boolean', returnType: 'Boolean', section: 'Boolean', boost: 96 },
  { label: 'compareTo', type: 'method', signature: 'fun compareTo(other: Boolean): Int', returnType: 'Int', section: 'Boolean', boost: 70 },
]

const charMembers: KotlinMemberInfo[] = [
  { label: 'code', type: 'property', signature: 'val code: Int', returnType: 'Int', section: 'Char', boost: 116 },
  { label: 'isDigit', type: 'method', signature: 'fun isDigit(): Boolean', returnType: 'Boolean', section: 'Char', boost: 100 },
  { label: 'isLetter', type: 'method', signature: 'fun isLetter(): Boolean', returnType: 'Boolean', section: 'Char', boost: 100 },
  { label: 'isLetterOrDigit', type: 'method', signature: 'fun isLetterOrDigit(): Boolean', returnType: 'Boolean', section: 'Char', boost: 96 },
  { label: 'lowercase', type: 'method', signature: 'fun lowercase(): String', returnType: 'String', section: 'Char', boost: 88 },
  { label: 'uppercase', type: 'method', signature: 'fun uppercase(): String', returnType: 'String', section: 'Char', boost: 88 },
]

const arrayMembers: KotlinMemberInfo[] = [
  ...collectionReadMembers,
  { label: 'set', type: 'method', signature: 'operator fun set(index: Int, value: T): Unit', returnType: 'Unit', section: 'Array', boost: 112 },
  { label: 'fill', type: 'method', signature: 'fun fill(element: T): Unit', returnType: 'Unit', section: 'Array', boost: 88 },
  { label: 'copyOf', type: 'method', signature: 'fun copyOf(newSize: Int = size): Array<T>', returnType: 'Array<T>', section: 'Array', boost: 92 },
  { label: 'copyOfRange', type: 'method', signature: 'fun copyOfRange(fromIndex: Int, toIndex: Int): Array<T>', returnType: 'Array<T>', section: 'Array', boost: 82 },
  { label: 'contentToString', type: 'method', signature: 'fun contentToString(): String', returnType: 'String', section: 'Array', boost: 82 },
  { label: 'contentEquals', type: 'method', signature: 'fun contentEquals(other: Array<T>): Boolean', returnType: 'Boolean', section: 'Array', boost: 72 },
  { label: 'sort', type: 'method', signature: 'fun sort(): Unit', returnType: 'Unit', section: 'Array', boost: 82 },
  { label: 'reverse', type: 'method', signature: 'fun reverse(): Unit', returnType: 'Unit', section: 'Array', boost: 80 },
]

const sequenceMembers: KotlinMemberInfo[] = [
  { label: 'map', type: 'method', signature: 'fun <R> map(transform: (T) -> R): Sequence<R>', returnType: 'Sequence<R>', section: 'Sequence', boost: 126 },
  { label: 'flatMap', type: 'method', signature: 'fun <R> flatMap(transform: (T) -> Sequence<R>): Sequence<R>', returnType: 'Sequence<R>', section: 'Sequence', boost: 100 },
  { label: 'filter', type: 'method', signature: 'fun filter(predicate: (T) -> Boolean): Sequence<T>', returnType: 'Sequence<T>', section: 'Sequence', boost: 124 },
  { label: 'filterNot', type: 'method', signature: 'fun filterNot(predicate: (T) -> Boolean): Sequence<T>', returnType: 'Sequence<T>', section: 'Sequence', boost: 92 },
  { label: 'take', type: 'method', signature: 'fun take(n: Int): Sequence<T>', returnType: 'Sequence<T>', section: 'Sequence', boost: 98 },
  { label: 'drop', type: 'method', signature: 'fun drop(n: Int): Sequence<T>', returnType: 'Sequence<T>', section: 'Sequence', boost: 94 },
  { label: 'distinct', type: 'method', signature: 'fun distinct(): Sequence<T>', returnType: 'Sequence<T>', section: 'Sequence', boost: 88 },
  { label: 'sorted', type: 'method', signature: 'fun sorted(): Sequence<T>', returnType: 'Sequence<T>', section: 'Sequence', boost: 84 },
  { label: 'forEach', type: 'method', signature: 'fun forEach(action: (T) -> Unit): Unit', returnType: 'Unit', section: 'Sequence', boost: 102 },
  { label: 'toList', type: 'method', signature: 'fun toList(): List<T>', returnType: 'List<T>', section: 'Convert', boost: 100 },
  { label: 'toSet', type: 'method', signature: 'fun toSet(): Set<T>', returnType: 'Set<T>', section: 'Convert', boost: 86 },
  { label: 'first', type: 'method', signature: 'fun first(): T', returnType: 'T', section: 'Sequence', boost: 88 },
  { label: 'firstOrNull', type: 'method', signature: 'fun firstOrNull(): T?', returnType: 'T?', section: 'Sequence', boost: 86 },
  { label: 'count', type: 'method', signature: 'fun count(): Int', returnType: 'Int', section: 'Aggregate', boost: 82 },
  { label: 'any', type: 'method', signature: 'fun any(predicate: (T) -> Boolean): Boolean', returnType: 'Boolean', section: 'Predicate', boost: 78 },
  { label: 'all', type: 'method', signature: 'fun all(predicate: (T) -> Boolean): Boolean', returnType: 'Boolean', section: 'Predicate', boost: 76 },
]

const pairMembers: KotlinMemberInfo[] = [
  { label: 'first', type: 'property', signature: 'val first: A', returnType: 'A', section: 'Pair', boost: 118 },
  { label: 'second', type: 'property', signature: 'val second: B', returnType: 'B', section: 'Pair', boost: 118 },
  { label: 'toList', type: 'method', signature: 'fun toList(): List<Any?>', returnType: 'List<Any?>', section: 'Pair', boost: 78 },
]

const resultMembers: KotlinMemberInfo[] = [
  { label: 'isSuccess', type: 'property', signature: 'val isSuccess: Boolean', returnType: 'Boolean', section: 'Result', boost: 116 },
  { label: 'isFailure', type: 'property', signature: 'val isFailure: Boolean', returnType: 'Boolean', section: 'Result', boost: 116 },
  { label: 'getOrNull', type: 'method', signature: 'fun getOrNull(): T?', returnType: 'T?', section: 'Result', boost: 106 },
  { label: 'getOrThrow', type: 'method', signature: 'fun getOrThrow(): T', returnType: 'T', section: 'Result', boost: 102 },
  { label: 'getOrDefault', type: 'method', signature: 'fun getOrDefault(defaultValue: T): T', returnType: 'T', section: 'Result', boost: 94 },
  { label: 'getOrElse', type: 'method', signature: 'fun getOrElse(onFailure: (Throwable) -> T): T', returnType: 'T', section: 'Result', boost: 94 },
  { label: 'map', type: 'method', signature: 'fun <R> map(transform: (T) -> R): Result<R>', returnType: 'Result<R>', section: 'Result', boost: 90 },
  { label: 'recover', type: 'method', signature: 'fun recover(transform: (Throwable) -> T): Result<T>', returnType: 'Result<T>', section: 'Result', boost: 84 },
]

const kotlinMemberDocs: Record<string, string> = {
  'string.length': 'Количество символов в строке.',
  'string.indices': 'Диапазон допустимых индексов строки: 0..lastIndex.',
  'string.lastIndex': 'Индекс последнего символа. Для пустой строки равен -1.',
  'string.substring': 'Возвращает часть строки по индексам.',
  'string.contains': 'Проверяет, входит ли символ или подстрока в строку.',
  'string.indexOf': 'Возвращает индекс первого вхождения или -1, если ничего не найдено.',
  'string.lastIndexOf': 'Возвращает индекс последнего вхождения или -1.',
  'string.lowercase': 'Возвращает новую строку в нижнем регистре.',
  'string.uppercase': 'Возвращает новую строку в верхнем регистре.',
  'string.trim': 'Удаляет пробельные символы в начале и конце строки.',
  'string.split': 'Разбивает строку на список частей.',
  'string.replace': 'Возвращает новую строку с замененными фрагментами.',
  'string.lines': 'Разбивает строку на строки с учетом разных переводов строки.',
  'string.toIntOrNull': 'Безопасно парсит Int: возвращает null вместо исключения.',
  'string.toRegex': 'Создает Regex из строки-шаблона.',
  'map.keys': 'Read-only набор ключей словаря.',
  'map.values': 'Read-only коллекция значений словаря.',
  'map.entries': 'Набор пар key/value, удобный для перебора и map/filter.',
  'map.get': 'Возвращает значение по ключу или null, если ключ отсутствует.',
  'map.getValue': 'Возвращает значение по ключу или бросает исключение, если ключа нет.',
  'map.getOrElse': 'Возвращает значение по ключу или результат defaultValue.',
  'map.getOrDefault': 'Возвращает значение по ключу или переданное значение по умолчанию.',
  'map.containsKey': 'Проверяет наличие ключа.',
  'map.containsValue': 'Проверяет наличие значения.',
  'map.mapKeys': 'Создает новый Map, преобразуя ключи.',
  'map.mapValues': 'Создает новый Map, преобразуя значения.',
  'map.filterKeys': 'Оставляет пары, ключи которых подходят под predicate.',
  'map.filterValues': 'Оставляет пары, значения которых подходят под predicate.',
  'mutableMap.put': 'Добавляет или заменяет значение по ключу.',
  'mutableMap.getOrPut': 'Возвращает существующее значение или создает и сохраняет новое.',
  'mutableMap.remove': 'Удаляет значение по ключу.',
  'mapEntry.key': 'Ключ текущей пары Map.Entry.',
  'mapEntry.value': 'Значение текущей пары Map.Entry.',
  'mapEntry.component1': 'Первый компонент для destructuring: val (key, value) = entry.',
  'mapEntry.component2': 'Второй компонент для destructuring: val (key, value) = entry.',
  'mutableList.add': 'Добавляет элемент в конец списка.',
  'mutableList.addAll': 'Добавляет все элементы коллекции.',
  'mutableList.remove': 'Удаляет первое совпадающее значение.',
  'mutableList.removeAt': 'Удаляет элемент по индексу и возвращает его.',
  'mutableList.set': 'Заменяет элемент по индексу.',
  'mutableList.sort': 'Сортирует список на месте.',
  'mutableList.shuffle': 'Перемешивает список на месте.',
  'mutableSet.add': 'Добавляет элемент, если его еще нет.',
  'mutableSet.remove': 'Удаляет элемент из множества.',
  'array.set': 'Записывает значение по индексу массива.',
  'array.copyOf': 'Создает копию массива, опционально с новым размером.',
  'array.copyOfRange': 'Копирует часть массива по диапазону индексов.',
  'array.contentToString': 'Возвращает читаемое строковое представление содержимого массива.',
  'array.fill': 'Заполняет массив одним значением.',
  'number.coerceIn': 'Ограничивает число диапазоном min..max.',
  'number.coerceAtLeast': 'Возвращает не меньше minimumValue.',
  'number.coerceAtMost': 'Возвращает не больше maximumValue.',
  'char.code': 'Unicode-код символа.',
  'char.isDigit': 'Проверяет, является ли символ цифрой.',
  'char.isLetter': 'Проверяет, является ли символ буквой.',
  'char.isLetterOrDigit': 'Проверяет букву или цифру.',
  'boolean.not': 'Логическое отрицание.',
  'boolean.and': 'Логическое И без short-circuit.',
  'boolean.or': 'Логическое ИЛИ без short-circuit.',
  'pair.first': 'Первое значение пары.',
  'pair.second': 'Второе значение пары.',
  'result.isSuccess': 'true, если Result содержит успешное значение.',
  'result.isFailure': 'true, если Result содержит исключение.',
  'result.getOrNull': 'Возвращает значение успеха или null.',
  'result.getOrThrow': 'Возвращает значение успеха или пробрасывает исключение.',
  'result.recover': 'Преобразует ошибку в успешное значение.',
  size: 'Количество элементов.',
  isEmpty: 'Проверяет, что элементов нет.',
  isNotEmpty: 'Проверяет, что есть хотя бы один элемент.',
  iterator: 'Возвращает Iterator для ручного обхода.',
  contains: 'Проверяет наличие элемента.',
  containsAll: 'Проверяет, что все элементы присутствуют.',
  get: 'Получает элемент по индексу или ключу.',
  elementAt: 'Получает элемент по индексу.',
  elementAtOrNull: 'Получает элемент по индексу или null, если индекс вне границ.',
  elementAtOrElse: 'Получает элемент или вызывает defaultValue для неверного индекса.',
  first: 'Возвращает первый элемент или бросает исключение, если коллекция пустая.',
  firstOrNull: 'Возвращает первый элемент или null.',
  last: 'Возвращает последний элемент или бросает исключение, если коллекция пустая.',
  lastOrNull: 'Возвращает последний элемент или null.',
  single: 'Возвращает единственный элемент или бросает исключение.',
  singleOrNull: 'Возвращает единственный элемент или null.',
  find: 'Возвращает первый элемент, подходящий под predicate.',
  findLast: 'Возвращает последний элемент, подходящий под predicate.',
  map: 'Преобразует каждый элемент и возвращает новую коллекцию результатов.',
  mapIndexed: 'Как map, но transform получает индекс элемента.',
  mapNotNull: 'Преобразует элементы и отбрасывает null-результаты.',
  flatMap: 'Преобразует каждый элемент в коллекцию и склеивает результаты.',
  filter: 'Оставляет элементы, для которых predicate возвращает true.',
  filterIndexed: 'Как filter, но predicate получает индекс.',
  filterNot: 'Оставляет элементы, для которых predicate возвращает false.',
  filterNotNull: 'Удаляет null-значения из коллекции.',
  forEach: 'Выполняет действие для каждого элемента.',
  forEachIndexed: 'Как forEach, но action получает индекс.',
  onEach: 'Выполняет side-effect для каждого элемента и возвращает исходную цепочку.',
  fold: 'Сворачивает коллекцию в одно значение, начиная с initial.',
  reduce: 'Сворачивает непустую коллекцию без initial.',
  reduceOrNull: 'Сворачивает коллекцию или возвращает null для пустой.',
  groupBy: 'Группирует элементы в Map по ключу.',
  associateBy: 'Создает Map, используя выбранный ключ для каждого элемента.',
  associateWith: 'Создает Map, где ключами становятся сами элементы.',
  partition: 'Разделяет коллекцию на две: подходящие и неподходящие элементы.',
  sorted: 'Возвращает отсортированный список.',
  sortedDescending: 'Возвращает список в обратном порядке сортировки.',
  sortedBy: 'Сортирует по выбранному ключу.',
  sortedByDescending: 'Сортирует по выбранному ключу по убыванию.',
  reversed: 'Возвращает элементы в обратном порядке.',
  shuffled: 'Возвращает элементы в случайном порядке.',
  distinct: 'Удаляет дубликаты, сохраняя порядок первого появления.',
  distinctBy: 'Удаляет дубликаты по вычисленному ключу.',
  joinToString: 'Склеивает элементы в строку.',
  take: 'Берет первые n элементов.',
  takeLast: 'Берет последние n элементов.',
  takeWhile: 'Берет элементы, пока predicate возвращает true.',
  drop: 'Пропускает первые n элементов.',
  dropLast: 'Пропускает последние n элементов.',
  slice: 'Возвращает элементы по набору индексов.',
  zip: 'Объединяет две коллекции попарно.',
  any: 'Проверяет, что хотя бы один элемент подходит под predicate.',
  all: 'Проверяет, что все элементы подходят под predicate.',
  none: 'Проверяет, что ни один элемент не подходит под predicate.',
  random: 'Возвращает случайный элемент.',
  count: 'Считает элементы, опционально подходящие под predicate.',
  sumOf: 'Суммирует значения, полученные selector-функцией.',
  minOrNull: 'Минимальный элемент или null для пустой коллекции.',
  maxOrNull: 'Максимальный элемент или null для пустой коллекции.',
  toList: 'Создает read-only List.',
  toMutableList: 'Создает MutableList-копию.',
  toSet: 'Создает read-only Set.',
  toMutableSet: 'Создает MutableSet-копию.',
  asSequence: 'Переходит к ленивой Sequence-цепочке.',
  asIterable: 'Возвращает Iterable-представление.',
  chunked: 'Разбивает коллекцию на блоки заданного размера.',
  windowed: 'Создает скользящие окна по коллекции.',
  plus: 'Возвращает новую коллекцию/значение с добавлением.',
  minus: 'Возвращает новую коллекцию/значение с удалением.',
  toString: 'Возвращает строковое представление значения.',
  equals: 'Проверяет структурное равенство.',
  hashCode: 'Возвращает hash code для equals/hash-based коллекций.',
  let: 'Передает receiver как it и возвращает результат блока.',
  also: 'Передает receiver как it и возвращает сам receiver.',
  apply: 'Выполняет блок с receiver this и возвращает сам receiver.',
  run: 'Выполняет блок с receiver this и возвращает результат.',
  takeIf: 'Возвращает receiver, если predicate true, иначе null.',
  takeUnless: 'Возвращает receiver, если predicate false, иначе null.',
}

const kotlinTypedMemberCatalog: Partial<Record<KotlinTypeCategory, KotlinMemberInfo[]>> = {
  string: stringMembers,
  char: charMembers,
  boolean: booleanMembers,
  number: numberMembers,
  list: collectionReadMembers,
  mutableList: [...collectionReadMembers, ...mutableListMembers],
  set: setMembers,
  mutableSet: [...setMembers, ...mutableSetMembers],
  map: mapMembers,
  mutableMap: [...mapMembers, ...mutableMapMembers],
  mapEntry: mapEntryMembers,
  array: arrayMembers,
  primitiveArray: arrayMembers,
  sequence: sequenceMembers,
  iterable: collectionReadMembers,
  pair: pairMembers,
  result: resultMembers,
}

const kotlinFallbackMemberCompletions: Completion[] = [
  ...commonScopeMembers,
  ...commonAnyMembers,
  ...collectionReadMembers.slice(0, 16),
  ...stringMembers.slice(0, 8),
].map((member) => kotlinMemberToCompletion(member, { name: 'Any', category: 'unknown', genericArguments: [], nullable: false }, 0))

const kotlinSnippetCompletions: Completion[] = [
  snippetCompletion('fun main() {\n    ${}\n}', {
    label: 'main',
    detail: 'fun main',
    type: 'function',
    section: 'Snippets',
  }),
  snippetCompletion('println(${})', {
    label: 'println',
    detail: 'print line',
    type: 'function',
    section: 'Snippets',
    boost: 90,
  }),
  snippetCompletion('data class ${Name}(val ${property}: ${Type})', {
    label: 'data class',
    detail: 'data class',
    type: 'class',
    section: 'Snippets',
  }),
  snippetCompletion('class ${Name} {\n    ${}\n}', {
    label: 'class',
    detail: 'class block',
    type: 'class',
    section: 'Snippets',
  }),
  snippetCompletion('when (${value}) {\n    ${condition} -> ${result}\n    else -> ${fallback}\n}', {
    label: 'when',
    detail: 'when expression',
    type: 'keyword',
    section: 'Snippets',
  }),
  snippetCompletion('for (${item} in ${items}) {\n    ${}\n}', {
    label: 'for',
    detail: 'for loop',
    type: 'keyword',
    section: 'Snippets',
  }),
  snippetCompletion('if (${condition}) {\n    ${}\n}', {
    label: 'if',
    detail: 'if block',
    type: 'keyword',
    section: 'Snippets',
  }),
]

onMounted(() => {
  loadPersistedState()
  hasHydrated.value = true
  loadCompilerVersions()
  nextTick(mountEditor)
})

onBeforeUnmount(() => {
  if (realtimeDiagnosticsTimer !== undefined) {
    window.clearTimeout(realtimeDiagnosticsTimer)
  }

  editorView.value?.destroy()
  editorView.value = null
})

watch(
  [nodes, activeFileId, selectedNodeId, openFileIds, expandedFolderIds, selectedCompilerVersion, programArgs],
  () => {
    if (hasHydrated.value) {
      persistState()
    }
  },
  { deep: true },
)

watch(
  selectedNode,
  (node) => {
    renameDraft.value = node?.name ?? ''
  },
  { immediate: true },
)

watch(
  activeFile,
  (file) => {
    if (!file) {
      return
    }

    activeFileId.value = file.id
    openFile(file.id)
    replaceEditorDocument(file.content)
    scheduleRealtimeDiagnostics(file.content, 0)

    if (!nodeMap.value.has(selectedNodeId.value)) {
      selectedNodeId.value = file.id
    }
  },
  { immediate: true },
)

watch(
  [diagnostics, activeFilePath],
  () => {
    reconfigureDiagnostics()
  },
  { deep: true },
)

function mountEditor() {
  if (!editorHostRef.value || editorView.value) {
    return
  }

  editorView.value = new EditorView({
    parent: editorHostRef.value,
    state: EditorState.create({
      doc: activeFile.value?.content ?? '',
      extensions: createEditorExtensions(),
    }),
  })
}

function createEditorExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    StreamLanguage.define(kotlin),
    syntaxHighlighting(kotlinHighlightStyle),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorState.tabSize.of(4),
    indentUnit.of('    '),
    placeholder('Создайте Kotlin-файл слева'),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setActiveFileContent(update.state.doc.toString())
      }
    }),
    autocompletion({
      activateOnTyping: true,
      activateOnTypingDelay: 0,
      maxRenderedOptions: 120,
      selectOnOpen: true,
      override: [localCompletionSource],
      optionClass: (completion) => `cm-kotlingo-completion-${completion.type ?? 'text'}`,
    }),
    createInlineSuggestionExtension(),
    hoverTooltip(kotlinHoverTooltipSource, { hoverTime: 180 }),
    diagnosticsCompartment.of(createDiagnosticsExtension()),
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          void runProject()
          return true
        },
      },
      {
        key: 'Mod-Shift-f',
        run: () => {
          formatActiveFile()
          return true
        },
      },
      {
        key: 'Tab',
        run: (view) => acceptInlineSuggestion(view) || acceptCompletion(view) || Boolean(indentWithTab.run?.(view)),
      },
      {
        key: '.',
        run: (view) => {
          view.dispatch(view.state.replaceSelection('.'))
          window.requestAnimationFrame(() => startCompletion(view))
          return true
        },
      },
      { key: 'Ctrl-Space', run: startCompletion },
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    kotlingoEditorTheme,
  ]
}

function localCompletionSource(context: CompletionContext): CompletionResult | null {
  const query = getCompletionQuery(context.state, context.pos)

  if (!query || (!query.prefix && !context.explicit && query.mode !== 'import' && query.mode !== 'member')) {
    return null
  }

  return {
    from: query.from,
    to: query.to,
    options: buildCompletionOptions(query),
    validFor:
      query.mode === 'import'
        ? /^$|^[A-Za-z_][\w.]*\*?$/
        : query.mode === 'member'
          ? /^$|^[A-Za-z_]\w*$/
          : /^[A-Za-z_]\w*$/,
  }
}

function getCompletionQuery(state: EditorState, pos: number): CompletionQuery | null {
  const line = state.doc.lineAt(pos)
  const cursorOffset = pos - line.from
  const before = line.text.slice(0, cursorOffset)
  const after = line.text.slice(cursorOffset)
  const importMatch = before.match(/^\s*import\s+([A-Za-z_][\w.]*\*?)?$/)
  const documentContent = state.doc.toString()

  if (importMatch) {
    const leftPrefix = importMatch[1] ?? ''
    const rightSuffix = after.match(/^[A-Za-z_][\w.]*\*?/)?.[0] ?? ''
    const prefix = `${leftPrefix}${rightSuffix}`

    return {
      from: pos - leftPrefix.length,
      to: pos + rightSuffix.length,
      prefix,
      mode: 'import',
      documentContent,
      cursorPosition: pos,
    }
  }

  const memberAccess = getMemberAccessAtCursor(before, after)

  if (memberAccess) {
    return {
      from: pos - memberAccess.leftPrefix.length,
      to: pos + memberAccess.rightSuffix.length,
      prefix: `${memberAccess.leftPrefix}${memberAccess.rightSuffix}`,
      mode: 'member',
      qualifier: memberAccess.qualifier,
      memberExpression: memberAccess.expression,
      documentContent,
      cursorPosition: pos,
    }
  }

  const leftWord = before.match(/[A-Za-z_]\w*$/)?.[0] ?? ''
  const rightWord = after.match(/^[A-Za-z_]\w*/)?.[0] ?? ''
  const word = `${leftWord}${rightWord}`

  if (!word) {
    return null
  }

  return {
    from: pos - leftWord.length,
    to: pos + rightWord.length,
    prefix: word,
    mode: 'default',
    documentContent,
    cursorPosition: pos,
  }
}

function buildCompletionOptions(query: CompletionQuery): Completion[] {
  if (query.mode === 'import') {
    return buildImportCompletionOptions()
  }

  if (query.mode === 'member') {
    return buildMemberCompletionOptions(query)
  }

  return [
    ...buildProjectCompletionOptions(),
    ...buildLocalScopeCompletionOptions(),
    ...kotlinSnippetCompletions,
    ...kotlinStdlibCompletions,
    ...kotlinKeywordCompletions,
  ]
}

function buildProjectCompletionOptions(): Completion[] {
  const seenLabels = new Set<string>()

  return localSymbols.value.flatMap((symbol) => {
    const key = `${symbol.name}:${symbol.importPath}`

    if (seenLabels.has(key)) {
      return []
    }

    seenLabels.add(key)

    const needsImport = Boolean(
      symbol.packageName &&
      symbol.fileId !== activeFileId.value &&
      symbol.packageName !== activePackage.value &&
      !parseKotlinImports(activeFile.value?.content ?? '').some((importItem) => importItem.path === symbol.importPath),
    )

    return [
      {
        label: symbol.name,
        type: completionType(symbol.kind),
        detail: needsImport ? `${symbol.importPath} + import` : symbol.fileId === activeFileId.value ? symbol.kind : symbol.importPath,
        info: `${symbol.kind} ${symbol.importPath}\n${symbol.filePath}`,
        boost: symbol.fileId === activeFileId.value ? 120 : needsImport ? 85 : 70,
        section: symbol.fileId === activeFileId.value ? 'Current file' : 'Project',
        apply: needsImport ? (view, _completion, from, to) => applySymbolCompletionWithImport(view, symbol, from, to) : undefined,
      },
    ]
  })
}

function buildLocalScopeCompletionOptions(): Completion[] {
  const content = activeFile.value?.content ?? ''
  const symbols = new Map<string, Completion>()
  const localRegex = /\b(?:val|var)\s+([A-Za-z_]\w*)/g
  const parameterRegex = /fun\s+\w+\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null

  while ((match = localRegex.exec(content)) !== null) {
    symbols.set(match[1], {
      label: match[1],
      type: 'variable',
      detail: 'local variable',
      boost: 140,
      section: 'Local scope',
    })
  }

  while ((match = parameterRegex.exec(content)) !== null) {
    match[1]
      .split(',')
      .map((parameter) => parameter.trim().match(/^([A-Za-z_]\w*)\s*:/)?.[1])
      .filter((parameter): parameter is string => Boolean(parameter))
      .forEach((parameter) => {
        symbols.set(parameter, {
          label: parameter,
          type: 'variable',
          detail: 'parameter',
          boost: 135,
          section: 'Local scope',
        })
      })
  }

  return Array.from(symbols.values())
}

function buildImportCompletionOptions(): Completion[] {
  const packageNames = new Set(exportedSymbols.value.map((symbol) => symbol.packageName).filter(Boolean))
  const packageOptions: Completion[] = Array.from(packageNames).flatMap((packageName) => [
    {
      label: `${packageName}.*`,
      type: 'namespace',
      detail: 'project package',
      boost: 80,
      section: 'Packages',
    },
    {
      label: packageName,
      type: 'namespace',
      detail: 'package',
      boost: 40,
      section: 'Packages',
    },
  ])

  return [
    ...exportedSymbols.value.map((symbol) => ({
      label: symbol.importPath,
      type: completionType(symbol.kind),
      detail: symbol.filePath,
      boost: 100,
      section: 'Project imports',
    })),
    ...packageOptions,
    ...['kotlin.collections.*', 'kotlin.math.*', 'kotlin.text.*', 'java.time.*', 'java.io.File', 'java.math.BigDecimal'].map(
      (label) => ({
        label,
        type: label.endsWith('.*') ? 'namespace' : 'type',
        detail: 'common import',
        section: 'Common imports',
      }),
    ),
  ]
}

function buildMemberCompletionOptions(query: CompletionQuery): Completion[] {
  const content = query.documentContent ?? activeFile.value?.content ?? ''
  const inferredType = inferExpressionType(query.memberExpression ?? query.qualifier ?? '', content, {
    cursorPosition: query.cursorPosition,
  })
  const localClass = inferredType?.symbol ?? resolveQualifierSymbol(query.qualifier, content)
  const typedMemberOptions = inferredType
    ? memberCatalogForType(inferredType).map((member) => kotlinMemberToCompletion(member, inferredType, 70))
    : []
  const commonMemberOptions = [...commonScopeMembers, ...commonAnyMembers].map((member) =>
    kotlinMemberToCompletion(member, inferredType ?? unknownTypeInfo(), 8, false),
  )
  const fallbackOptions =
    !inferredType || inferredType.category === 'unknown' ? kotlinFallbackMemberCompletions : []

  return dedupeCompletionOptions([
    ...(localClass ? extractClassMemberCompletions(localClass) : []),
    ...typedMemberOptions,
    ...commonMemberOptions,
    ...fallbackOptions,
  ])
}

function extractClassMemberCompletions(symbol: ExportedSymbol): Completion[] {
  return dedupeSymbolMembers([...symbol.members, ...syntheticDataClassMembers(symbol)]).map((member) => ({
    label: member.name,
    type: completionType(member.kind),
    detail: member.signature,
    info: `${member.signature}\n${symbol.filePath}`,
    boost: member.kind === 'fun' ? 132 : 138,
    section: `${symbol.name} members`,
  }))
}

function kotlinMemberToCompletion(
  member: KotlinMemberInfo,
  ownerType: KotlinTypeInfo,
  boostOffset = 0,
  specializeSignature = true,
): Completion {
  const signature = specializeSignature ? specializeMemberSignature(member.signature, ownerType) : member.signature
  const description = member.description ?? kotlinMemberDescription(member, ownerType)

  return {
    label: member.label,
    type: member.type,
    detail: signature,
    info: description ? `${signature}\n${description}` : signature,
    boost: (member.boost ?? 0) + boostOffset,
    section: member.section ?? typeDisplayName(ownerType),
  }
}

function kotlinMemberDescription(member: KotlinMemberInfo, ownerType: KotlinTypeInfo): string {
  const ownerKeys = memberDocOwnerKeys(ownerType)
  const keyedDescription = ownerKeys
    .map((ownerKey) => kotlinMemberDocs[`${ownerKey}.${member.label}`])
    .find(Boolean)

  return keyedDescription ?? kotlinMemberDocs[member.label] ?? ''
}

function memberDocOwnerKeys(ownerType: KotlinTypeInfo): string[] {
  const keys = [ownerType.category]

  if (ownerType.category === 'primitiveArray') {
    keys.push('array')
  }

  if (ownerType.category === 'mutableList') {
    keys.push('list')
  }

  if (ownerType.category === 'mutableSet') {
    keys.push('set')
  }

  if (ownerType.category === 'mutableMap') {
    keys.push('map')
  }

  return keys
}

function memberCatalogForType(typeInfo: KotlinTypeInfo): KotlinMemberInfo[] {
  return kotlinTypedMemberCatalog[typeInfo.category] ?? []
}

function specializeMemberSignature(signature: string, typeInfo: KotlinTypeInfo): string {
  const generics = typeInfo.genericArguments
  const receiver = typeDisplayName(typeInfo)
  const replacements: Record<string, string> = {
    T: generics[0] ?? receiver,
    K: generics[0] ?? 'K',
    V: generics[1] ?? 'V',
    A: generics[0] ?? 'A',
    B: generics[1] ?? 'B',
  }

  return Object.entries(replacements).reduce(
    (result, [placeholder, replacement]) => result.replace(new RegExp(`\\b${placeholder}\\b`, 'g'), replacement),
    signature,
  )
}

function dedupeCompletionOptions(options: Completion[]): Completion[] {
  const seen = new Set<string>()

  return options.filter((option) => {
    const key = `${option.label}:${option.type ?? 'text'}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function getMemberAccessAtCursor(
  before: string,
  after: string,
): { expression: string; qualifier?: string; leftPrefix: string; rightSuffix: string } | null {
  const memberMatch = before.match(/([\s\S]+?)(?:\?\.|!!\.|\.)([A-Za-z_]\w*)?$/)

  if (!memberMatch) {
    return null
  }

  const expression = extractTrailingMemberExpression(memberMatch[1])

  if (!expression) {
    return null
  }

  const leftPrefix = memberMatch[2] ?? ''
  const rightSuffix = after.match(/^[A-Za-z_]\w*/)?.[0] ?? ''
  const qualifier = expression.match(/[A-Za-z_]\w*$/)?.[0]

  return {
    expression,
    qualifier,
    leftPrefix,
    rightSuffix,
  }
}

function extractTrailingMemberExpression(value: string): string {
  const text = value.trimEnd()
  let parenDepth = 0
  let bracketDepth = 0
  let braceDepth = 0
  let angleDepth = 0

  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index]

    if (char === ')') {
      parenDepth += 1
      continue
    }

    if (char === '(') {
      if (parenDepth === 0) {
        return cleanupMemberExpression(text.slice(index + 1))
      }

      parenDepth -= 1
      continue
    }

    if (char === ']') {
      bracketDepth += 1
      continue
    }

    if (char === '[') {
      if (bracketDepth === 0) {
        return cleanupMemberExpression(text.slice(index + 1))
      }

      bracketDepth -= 1
      continue
    }

    if (char === '}') {
      braceDepth += 1
      continue
    }

    if (char === '{') {
      if (braceDepth === 0) {
        return cleanupMemberExpression(text.slice(index + 1))
      }

      braceDepth -= 1
      continue
    }

    if (char === '>' && text[index - 1] !== '-' && text[index - 1] !== '=') {
      angleDepth += 1
      continue
    }

    if (char === '<') {
      if (angleDepth === 0) {
        return cleanupMemberExpression(text.slice(index + 1))
      }

      angleDepth -= 1
      continue
    }

    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0 && char === '-' && text[index + 1] === '>') {
      return cleanupMemberExpression(text.slice(index + 2))
    }

    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0 && /[=,;+\-*/%?:]/.test(char)) {
      return cleanupMemberExpression(text.slice(index + 1))
    }
  }

  return cleanupMemberExpression(text)
}

function cleanupMemberExpression(expression: string): string {
  return expression
    .trim()
    .replace(/^(?:return|throw|yield)\s+/, '')
    .replace(/^(?:val|var)\s+[A-Za-z_]\w*\s*=\s*/, '')
    .trim()
}

function inferExpressionType(expression: string, content: string, context: TypeInferenceContext = {}): KotlinTypeInfo | null {
  const normalizedExpression = stripOuterParentheses(cleanupExpression(expression))

  if (!normalizedExpression) {
    return null
  }

  const indexAccessType = inferIndexAccessType(normalizedExpression, content, context)

  if (indexAccessType) {
    return indexAccessType
  }

  const chainedType = inferChainedExpressionType(normalizedExpression, content, context)

  if (chainedType) {
    return chainedType
  }

  if (/^"""/.test(normalizedExpression) || /^"(?:\\.|[^"\\])*"$/.test(normalizedExpression)) {
    return typeInfoFromTypeName('String')
  }

  if (/^'(?:\\.|[^'\\])'$/.test(normalizedExpression)) {
    return typeInfoFromTypeName('Char')
  }

  if (/^(?:true|false)$/.test(normalizedExpression)) {
    return typeInfoFromTypeName('Boolean')
  }

  if (/^-?\d+(?:\.\d+)?(?:[fFdDlL])?$/.test(normalizedExpression)) {
    return typeInfoFromTypeName(/[fFdD]$|\./.test(normalizedExpression) ? 'Double' : 'Int')
  }

  const identifierMatch = normalizedExpression.match(/^[A-Za-z_]\w*$/)

  if (identifierMatch) {
    return inferIdentifierType(identifierMatch[0], content, context) ?? typeInfoFromTypeName(identifierMatch[0])
  }

  const callType = inferKnownCallType(normalizedExpression, content, context)

  if (callType) {
    return callType
  }

  return null
}

function cleanupExpression(expression: string): string {
  return expression.replace(/\/\/.*$/, '').trim()
}

function stripOuterParentheses(expression: string): string {
  let result = expression.trim()

  while (result.startsWith('(') && result.endsWith(')') && wrapsWholeExpression(result)) {
    result = result.slice(1, -1).trim()
  }

  return result
}

function wrapsWholeExpression(expression: string): boolean {
  let depth = 0

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index]

    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1

      if (depth === 0 && index < expression.length - 1) {
        return false
      }
    }
  }

  return depth === 0
}

function inferIndexAccessType(expression: string, content: string, context: TypeInferenceContext = {}): KotlinTypeInfo | null {
  const match = expression.match(/^([\s\S]+)\[[\s\S]*\]$/)

  if (!match) {
    return null
  }

  const receiverType = inferExpressionType(match[1], content, context)

  if (!receiverType) {
    return null
  }

  if (['list', 'mutableList', 'array', 'primitiveArray', 'set', 'mutableSet', 'sequence', 'iterable'].includes(receiverType.category)) {
    return elementTypeInfo(receiverType)
  }

  if (['map', 'mutableMap'].includes(receiverType.category)) {
    return typeInfoFromTypeName(receiverType.genericArguments[1] ?? 'Any?')
  }

  if (receiverType.category === 'string') {
    return typeInfoFromTypeName('Char')
  }

  return null
}

function inferChainedExpressionType(expression: string, content: string, context: TypeInferenceContext = {}): KotlinTypeInfo | null {
  const match = expression.match(/^([\s\S]+)\.([A-Za-z_]\w*)\s*(?:\([^)]*\))?(?:\s*\{[\s\S]*\})?$/)

  if (!match) {
    return null
  }

  const receiverType = inferExpressionType(match[1], content, context)

  if (!receiverType) {
    return null
  }

  return inferMemberReturnType(receiverType, match[2])
}

function inferMemberReturnType(receiverType: KotlinTypeInfo, memberName: string): KotlinTypeInfo | null {
  const userMember = receiverType.symbol?.members.find((member) => member.name === memberName)

  if (userMember) {
    return typeInfoFromTypeName(memberReturnType(userMember) || 'Any?')
  }

  const member = memberCatalogForType(receiverType).find((item) => item.label === memberName)
  const commonMember = [...commonAnyMembers, ...commonScopeMembers].find((item) => item.label === memberName)
  const resolvedMember = member ?? commonMember

  if (!resolvedMember) {
    return null
  }

  const returnType = specializeMemberSignature(
    resolvedMember.returnType ?? kotlinMemberInfoReturnType(resolvedMember),
    receiverType,
  )

  if (!returnType) {
    return unknownTypeInfo()
  }

  return typeInfoFromTypeName(returnType)
}

function inferIdentifierType(name: string, content: string, context: TypeInferenceContext = {}): KotlinTypeInfo | null {
  const directType = typeInfoFromTypeName(name)

  if (directType?.symbol) {
    return directType
  }

  const lambdaParameterType =
    context.cursorPosition === undefined ? null : inferLambdaParameterType(name, content, context.cursorPosition)

  if (lambdaParameterType) {
    return lambdaParameterType
  }

  const explicitVariableType = content.match(
    new RegExp(`\\b(?:val|var)\\s+${escapeRegExp(name)}\\s*:\\s*([^=\\n]+)`),
  )?.[1]

  if (explicitVariableType) {
    return typeInfoFromTypeName(explicitVariableType)
  }

  const initializer = content.match(
    new RegExp(`\\b(?:val|var)\\s+${escapeRegExp(name)}\\b[^=\\n]*=\\s*([^\\n]+)`),
  )?.[1]

  if (initializer) {
    const initializerType = inferExpressionType(initializer, content, context)

    if (initializerType) {
      return initializerType
    }
  }

  const parameterType = findParameterType(name, content)

  if (parameterType) {
    return typeInfoFromTypeName(parameterType)
  }

  const loopElementType = findLoopElementType(name, content, context)

  if (loopElementType) {
    return loopElementType
  }

  const functionSymbol = localSymbols.value.find((symbol) => symbol.kind === 'fun' && symbol.name === name && symbol.returnType)

  if (functionSymbol) {
    return typeInfoFromTypeName(functionSymbol.returnType)
  }

  return null
}

function findParameterType(name: string, content: string): string {
  const parameterLists = content.matchAll(/\(([^()]*)\)/g)

  for (const match of parameterLists) {
    const parameter = splitTopLevel(match[1])
      .map((item) => item.trim())
      .find((item) => new RegExp(`^${escapeRegExp(name)}\\s*:`).test(item))
    const typeName = parameter?.match(/:\s*(.+)$/)?.[1]?.trim()

    if (typeName) {
      return typeName
    }
  }

  return ''
}

function findLoopElementType(name: string, content: string, context: TypeInferenceContext = {}): KotlinTypeInfo | null {
  const loopRegex = new RegExp(`for\\s*\\(\\s*${escapeRegExp(name)}\\s+in\\s+([^)]*)\\)`, 'g')
  const match = loopRegex.exec(content)

  if (!match) {
    return null
  }

  const collectionType = inferExpressionType(match[1], content, context)

  return collectionType ? elementTypeInfo(collectionType) : null
}

function inferLambdaParameterType(name: string, content: string, cursorPosition: number): KotlinTypeInfo | null {
  const lambda = findCurrentLambda(content, cursorPosition)

  if (!lambda) {
    return null
  }

  const callContext = findLambdaCallContext(content, lambda.openBrace)

  if (!callContext) {
    return null
  }

  const lambdaContentBeforeCursor = content.slice(lambda.openBrace + 1, cursorPosition)
  const parameters = parseLambdaParameters(lambdaContentBeforeCursor)

  if (parameters.length > 0) {
    const parameterIndex = parameters.findIndex((parameter) => parameter.name === name)
    const parameter = parameters[parameterIndex]

    if (parameterIndex < 0) {
      return null
    }

    if (parameter.explicitType) {
      return typeInfoFromTypeName(parameter.explicitType)
    }

    return inferLambdaParameterTypeByIndex(callContext, parameterIndex, parameters.length)
  }

  return name === 'it' ? inferLambdaParameterTypeByIndex(callContext, 0, 1) : null
}

function findCurrentLambda(content: string, cursorPosition: number): { openBrace: number } | null {
  const stack: number[] = []
  let inLineComment = false
  let inBlockComment = false
  let inString = false
  let inChar = false
  let inTripleString = false

  for (let index = 0; index < Math.min(cursorPosition, content.length); index += 1) {
    const char = content[index]
    const next = content[index + 1]
    const previous = content[index - 1]

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
      }
      continue
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        index += 1
      }
      continue
    }

    if (inTripleString) {
      if (char === '"' && next === '"' && content[index + 2] === '"') {
        inTripleString = false
        index += 2
      }
      continue
    }

    if (inString) {
      if (char === '"' && previous !== '\\') {
        inString = false
      }
      continue
    }

    if (inChar) {
      if (char === "'" && previous !== '\\') {
        inChar = false
      }
      continue
    }

    if (char === '/' && next === '/') {
      inLineComment = true
      index += 1
      continue
    }

    if (char === '/' && next === '*') {
      inBlockComment = true
      index += 1
      continue
    }

    if (char === '"' && next === '"' && content[index + 2] === '"') {
      inTripleString = true
      index += 2
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "'") {
      inChar = true
      continue
    }

    if (char === '{') {
      stack.push(index)
    } else if (char === '}') {
      stack.pop()
    }
  }

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const openBrace = stack[index]

    if (findLambdaCallContext(content, openBrace)) {
      return { openBrace }
    }
  }

  return null
}

function findLambdaCallContext(content: string, openBrace: number): LambdaCallContext | null {
  const before = content.slice(0, openBrace).trimEnd()
  const memberCall = before.match(/([\s\S]+)(?:\?\.|!!\.|\.)([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\))?$/)

  if (memberCall) {
    const receiverExpression = extractTrailingMemberExpression(memberCall[1])

    if (!receiverExpression) {
      return null
    }

    const callName = memberCall[2]
    const receiverType = inferExpressionType(receiverExpression, content, { cursorPosition: openBrace })

    if (!receiverType || !isKnownLambdaMemberCall(callName, receiverType)) {
      return null
    }

    return {
      callName,
      receiverExpression,
      receiverType,
      callArguments: splitCallArguments(memberCall[3] ?? ''),
    }
  }

  const topLevelCall = before.match(/\b([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\))?$/)

  if (!topLevelCall || !isKnownTopLevelLambdaCall(topLevelCall[1])) {
    return null
  }

  return {
    callName: topLevelCall[1],
    callArguments: splitCallArguments(topLevelCall[2] ?? ''),
  }
}

function isKnownLambdaMemberCall(callName: string, receiverType: KotlinTypeInfo): boolean {
  if (['let', 'also', 'takeIf', 'takeUnless'].includes(callName)) {
    return true
  }

  return Boolean(inferMemberReturnType(receiverType, callName) || memberCatalogForType(receiverType).some((member) => member.label === callName))
}

function isKnownTopLevelLambdaCall(callName: string): boolean {
  return ['run', 'with', 'buildList', 'buildSet', 'buildMap', 'sequence'].includes(callName)
}

function splitCallArguments(rawArguments: string): string[] {
  return rawArguments.trim() ? splitTopLevel(rawArguments).map((argument) => argument.trim()) : []
}

function parseLambdaParameters(lambdaContentBeforeCursor: string): LambdaParameterInfo[] {
  const arrowIndex = findTopLevelArrow(lambdaContentBeforeCursor)

  if (arrowIndex < 0) {
    return []
  }

  const declaration = stripOuterParentheses(lambdaContentBeforeCursor.slice(0, arrowIndex).trim())

  if (!declaration) {
    return []
  }

  return splitTopLevel(declaration)
    .map((parameter) => parameter.trim())
    .map<LambdaParameterInfo | null>((parameter) => {
      const match = parameter.match(/^([A-Za-z_]\w*)\s*(?::\s*([\s\S]+))?$/)

      return match ? { name: match[1], explicitType: match[2]?.trim() } : null
    })
    .filter((parameter): parameter is LambdaParameterInfo => Boolean(parameter))
}

function findTopLevelArrow(value: string): number {
  let parenDepth = 0
  let bracketDepth = 0
  let braceDepth = 0
  let angleDepth = 0

  for (let index = 0; index < value.length - 1; index += 1) {
    const char = value[index]
    const next = value[index + 1]

    if (char === '-' && next === '>' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0) {
      return index
    }

    if (char === '(') {
      parenDepth += 1
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1)
    } else if (char === '[') {
      bracketDepth += 1
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
    } else if (char === '{') {
      braceDepth += 1
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1)
    } else if (char === '<') {
      angleDepth += 1
    } else if (char === '>') {
      angleDepth = Math.max(0, angleDepth - 1)
    }
  }

  return -1
}

function inferLambdaParameterTypeByIndex(
  callContext: LambdaCallContext,
  parameterIndex: number,
  parameterCount: number,
): KotlinTypeInfo | null {
  const receiverType = callContext.receiverType

  if (!receiverType) {
    return inferTopLevelLambdaParameterType(callContext, parameterIndex)
  }

  if (['let', 'also', 'takeIf', 'takeUnless'].includes(callContext.callName)) {
    return parameterIndex === 0 ? receiverType : null
  }

  if (receiverType.category === 'map' || receiverType.category === 'mutableMap') {
    return inferMapLambdaParameterType(receiverType, callContext.callName, parameterIndex, parameterCount)
  }

  if (receiverType.category === 'string') {
    return inferStringLambdaParameterType(callContext.callName, parameterIndex)
  }

  return inferCollectionLambdaParameterType(receiverType, callContext.callName, parameterIndex)
}

function inferTopLevelLambdaParameterType(callContext: LambdaCallContext, parameterIndex: number): KotlinTypeInfo | null {
  if (callContext.callName === 'with' && parameterIndex === 0 && callContext.callArguments[0]) {
    return inferExpressionType(callContext.callArguments[0], activeFile.value?.content ?? '')
  }

  return null
}

function inferMapLambdaParameterType(
  receiverType: KotlinTypeInfo,
  callName: string,
  parameterIndex: number,
  parameterCount: number,
): KotlinTypeInfo | null {
  const keyType = typeInfoFromTypeName(receiverType.genericArguments[0] ?? 'K') ?? unknownTypeInfo()
  const valueType = typeInfoFromTypeName(receiverType.genericArguments[1] ?? 'V') ?? unknownTypeInfo()
  const entryType = mapEntryTypeInfo(receiverType)

  if (callName === 'filterKeys') {
    return parameterIndex === 0 ? keyType : null
  }

  if (callName === 'filterValues') {
    return parameterIndex === 0 ? valueType : null
  }

  if (parameterCount >= 2 && ['forEach', 'map', 'filter', 'onEach'].includes(callName)) {
    return parameterIndex === 0 ? keyType : parameterIndex === 1 ? valueType : null
  }

  return ['map', 'mapKeys', 'mapValues', 'filter', 'forEach', 'onEach', 'any', 'all', 'none'].includes(callName) && parameterIndex === 0
    ? entryType
    : null
}

function inferStringLambdaParameterType(callName: string, parameterIndex: number): KotlinTypeInfo | null {
  const charType = typeInfoFromTypeName('Char')

  return parameterIndex === 0 &&
    ['filter', 'filterNot', 'map', 'forEach', 'any', 'all', 'none', 'count', 'find', 'first', 'last', 'takeWhile', 'dropWhile'].includes(callName)
    ? charType
    : null
}

function inferCollectionLambdaParameterType(receiverType: KotlinTypeInfo, callName: string, parameterIndex: number): KotlinTypeInfo | null {
  const elementType = elementTypeInfo(receiverType)

  if (['filterIndexed', 'mapIndexed', 'forEachIndexed'].includes(callName)) {
    return parameterIndex === 0 ? typeInfoFromTypeName('Int') : parameterIndex === 1 ? elementType : null
  }

  if (callName === 'foldIndexed') {
    return parameterIndex === 0 ? typeInfoFromTypeName('Int') : parameterIndex === 2 ? elementType : null
  }

  if (callName === 'fold') {
    return parameterIndex === 1 ? elementType : null
  }

  if (['reduce', 'reduceOrNull'].includes(callName)) {
    return parameterIndex <= 1 ? elementType : null
  }

  return [
    'filter',
    'filterNot',
    'map',
    'mapNotNull',
    'flatMap',
    'forEach',
    'onEach',
    'any',
    'all',
    'none',
    'count',
    'find',
    'findLast',
    'first',
    'firstOrNull',
    'last',
    'lastOrNull',
    'single',
    'singleOrNull',
    'sortedBy',
    'sortedByDescending',
    'distinctBy',
    'groupBy',
    'associateBy',
    'associateWith',
    'sumOf',
    'takeWhile',
    'dropWhile',
    'partition',
    'replaceAll',
    'sortBy',
  ].includes(callName) && parameterIndex === 0
    ? elementType
    : null
}

function mapEntryTypeInfo(mapType: KotlinTypeInfo): KotlinTypeInfo {
  return typeInfoFromTypeName(
    `Map.Entry<${mapType.genericArguments[0] ?? 'K'}, ${mapType.genericArguments[1] ?? 'V'}>`,
  ) ?? unknownTypeInfo()
}

function inferKnownCallType(expression: string, content: string, context: TypeInferenceContext = {}): KotlinTypeInfo | null {
  const call = expression.match(/^([A-Za-z_]\w*)\s*(?:<([^>]*)>)?\s*\(/)

  if (!call) {
    return null
  }

  const callName = call[1]
  const explicitGenerics = call[2] ? splitTopLevel(call[2]).map((item) => item.trim()).filter(Boolean) : []
  const argumentTypes = inferCallArgumentTypes(expression, content, context)
  const mapEntryTypes = inferMapEntryTypes(expression, content, context)

  switch (callName) {
    case 'listOf':
    case 'listOfNotNull':
    case 'emptyList':
    case 'buildList':
    case 'List':
      return typeInfoFromTypeName(`List<${explicitGenerics[0] ?? argumentTypes[0] ?? 'Any?'}>`)
    case 'mutableListOf':
    case 'arrayListOf':
    case 'MutableList':
    case 'ArrayList':
      return typeInfoFromTypeName(`MutableList<${explicitGenerics[0] ?? argumentTypes[0] ?? 'Any?'}>`)
    case 'setOf':
    case 'emptySet':
    case 'buildSet':
    case 'Set':
      return typeInfoFromTypeName(`Set<${explicitGenerics[0] ?? argumentTypes[0] ?? 'Any?'}>`)
    case 'mutableSetOf':
    case 'hashSetOf':
    case 'linkedSetOf':
    case 'MutableSet':
    case 'HashSet':
    case 'LinkedHashSet':
      return typeInfoFromTypeName(`MutableSet<${explicitGenerics[0] ?? argumentTypes[0] ?? 'Any?'}>`)
    case 'mapOf':
    case 'emptyMap':
    case 'buildMap':
    case 'Map':
      return typeInfoFromTypeName(`Map<${explicitGenerics[0] ?? mapEntryTypes[0] ?? 'K'}, ${explicitGenerics[1] ?? mapEntryTypes[1] ?? 'V'}>`)
    case 'mutableMapOf':
    case 'hashMapOf':
    case 'linkedMapOf':
    case 'MutableMap':
    case 'HashMap':
    case 'LinkedHashMap':
      return typeInfoFromTypeName(`MutableMap<${explicitGenerics[0] ?? mapEntryTypes[0] ?? 'K'}, ${explicitGenerics[1] ?? mapEntryTypes[1] ?? 'V'}>`)
    case 'arrayOf':
    case 'arrayOfNulls':
    case 'emptyArray':
    case 'Array':
      return typeInfoFromTypeName(`Array<${explicitGenerics[0] ?? argumentTypes[0] ?? 'Any?'}>`)
    case 'intArrayOf':
      return typeInfoFromTypeName('IntArray')
    case 'longArrayOf':
      return typeInfoFromTypeName('LongArray')
    case 'doubleArrayOf':
      return typeInfoFromTypeName('DoubleArray')
    case 'floatArrayOf':
      return typeInfoFromTypeName('FloatArray')
    case 'booleanArrayOf':
      return typeInfoFromTypeName('BooleanArray')
    case 'charArrayOf':
      return typeInfoFromTypeName('CharArray')
    case 'sequenceOf':
    case 'generateSequence':
      return typeInfoFromTypeName(`Sequence<${explicitGenerics[0] ?? argumentTypes[0] ?? 'Any?'}>`)
    case 'Pair':
      return typeInfoFromTypeName(`Pair<${argumentTypes[0] ?? explicitGenerics[0] ?? 'A'}, ${argumentTypes[1] ?? explicitGenerics[1] ?? 'B'}>`)
    case 'Result':
      return typeInfoFromTypeName(`Result<${explicitGenerics[0] ?? argumentTypes[0] ?? 'T'}>`)
    default:
      break
  }

  const constructorType = typeInfoFromTypeName(callName)

  if (constructorType?.symbol) {
    return constructorType
  }

  const functionSymbol = localSymbols.value.find((symbol) => symbol.kind === 'fun' && symbol.name === callName && symbol.returnType)

  return functionSymbol ? typeInfoFromTypeName(functionSymbol.returnType) : null
}

function inferCallArgumentTypes(expression: string, content: string, context: TypeInferenceContext = {}): string[] {
  const args = expression.match(/^[A-Za-z_]\w*\s*(?:<[^>]*>)?\s*\(([\s\S]*)\)/)?.[1]

  if (!args) {
    return []
  }

  return splitTopLevel(args)
    .map((argument) => inferExpressionType(argument, content, context))
    .map((typeInfo) => (typeInfo ? typeDisplayName(typeInfo) : ''))
    .filter(Boolean)
}

function inferMapEntryTypes(expression: string, content: string, context: TypeInferenceContext = {}): string[] {
  const args = expression.match(/^[A-Za-z_]\w*\s*(?:<[^>]*>)?\s*\(([\s\S]*)\)/)?.[1]

  if (!args) {
    return []
  }

  const entry = splitTopLevel(args)[0]?.match(/^([\s\S]+?)\s+to\s+([\s\S]+)$/)

  if (!entry) {
    return []
  }

  return [entry[1], entry[2]]
    .map((expressionPart) => inferExpressionType(expressionPart, content, context))
    .map((typeInfo) => (typeInfo ? typeDisplayName(typeInfo) : ''))
    .filter(Boolean)
}

function typeInfoFromTypeName(rawType: string): KotlinTypeInfo | null {
  const parsed = parseKotlinType(rawType)

  if (!parsed.baseName) {
    return null
  }

  const categoryByType: Record<string, KotlinTypeCategory> = {
    String: 'string',
    CharSequence: 'string',
    Char: 'char',
    Boolean: 'boolean',
    Byte: 'number',
    Short: 'number',
    Int: 'number',
    Long: 'number',
    Float: 'number',
    Double: 'number',
    Number: 'number',
    List: 'list',
    Collection: 'iterable',
    Iterable: 'iterable',
    MutableList: 'mutableList',
    ArrayList: 'mutableList',
    Set: 'set',
    MutableSet: 'mutableSet',
    HashSet: 'mutableSet',
    LinkedHashSet: 'mutableSet',
    Map: 'map',
    MutableMap: 'mutableMap',
    HashMap: 'mutableMap',
    LinkedHashMap: 'mutableMap',
    Entry: 'mapEntry',
    Array: 'array',
    IntArray: 'primitiveArray',
    LongArray: 'primitiveArray',
    DoubleArray: 'primitiveArray',
    FloatArray: 'primitiveArray',
    BooleanArray: 'primitiveArray',
    CharArray: 'primitiveArray',
    ByteArray: 'primitiveArray',
    ShortArray: 'primitiveArray',
    Sequence: 'sequence',
    Pair: 'pair',
    Result: 'result',
    Unit: 'unit',
  }
  const symbol = localSymbols.value.find(
    (item) => item.name === parsed.baseName && ['class', 'object', 'interface'].includes(item.kind),
  )

  return {
    name: parsed.baseName,
    category: symbol ? 'user' : categoryByType[parsed.baseName] ?? 'unknown',
    symbol,
    genericArguments: parsed.genericArguments,
    nullable: parsed.nullable,
  }
}

function parseKotlinType(rawType: string): { baseName: string; genericArguments: string[]; nullable: boolean } {
  const normalized = rawType
    .replace(/\b(?:out|in|vararg|noinline|crossinline)\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const nullable = /\?$/.test(normalized)
  const nonNullable = normalized.replace(/\?$/, '').trim()
  const baseMatch = nonNullable.match(/^([A-Za-z_][\w.]*)(?:\s*<([\s\S]*)>)?/)
  const baseName = baseMatch?.[1]?.split('.').at(-1) ?? ''
  const genericArguments = baseMatch?.[2]
    ? splitTopLevel(baseMatch[2])
        .map((item) => item.trim())
        .filter(Boolean)
    : []

  return { baseName, genericArguments, nullable }
}

function elementTypeInfo(typeInfo: KotlinTypeInfo): KotlinTypeInfo {
  if (typeInfo.category === 'string') {
    return typeInfoFromTypeName('Char') ?? unknownTypeInfo()
  }

  if (typeInfo.category === 'primitiveArray') {
    const primitiveType = typeInfo.name.replace(/Array$/, '') || 'Int'

    return typeInfoFromTypeName(primitiveType) ?? unknownTypeInfo()
  }

  return typeInfoFromTypeName(typeInfo.genericArguments[0] ?? 'Any?') ?? unknownTypeInfo()
}

function memberReturnType(member: SymbolMember): string {
  return member.signature.match(/:\s*([^={]+)$/)?.[1]?.trim() ?? extractReturnType(member.signature)
}

function typeDisplayName(typeInfo: KotlinTypeInfo): string {
  const generics = typeInfo.genericArguments.length > 0 ? `<${typeInfo.genericArguments.join(', ')}>` : ''

  return `${typeInfo.name}${generics}${typeInfo.nullable ? '?' : ''}`
}

function unknownTypeInfo(): KotlinTypeInfo {
  return {
    name: 'Any',
    category: 'unknown',
    genericArguments: [],
    nullable: false,
  }
}

function splitTopLevel(value: string): string[] {
  const result: string[] = []
  let current = ''
  let parenDepth = 0
  let bracketDepth = 0
  let braceDepth = 0
  let angleDepth = 0

  for (const char of value) {
    if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0) {
      result.push(current)
      current = ''
      continue
    }

    current += char

    if (char === '(') {
      parenDepth += 1
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1)
    } else if (char === '[') {
      bracketDepth += 1
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
    } else if (char === '{') {
      braceDepth += 1
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1)
    } else if (char === '<') {
      angleDepth += 1
    } else if (char === '>') {
      angleDepth = Math.max(0, angleDepth - 1)
    }
  }

  if (current.trim()) {
    result.push(current)
  }

  return result
}

const kotlinHoverTooltipSource: HoverTooltipSource = (view, pos) => {
  const hoveredWord = wordAtPosition(view.state, pos)

  if (!hoveredWord) {
    return null
  }

  const symbol = findHoverSymbol(hoveredWord.text, view.state, hoveredWord.from)

  if (!symbol) {
    return null
  }

  return {
    pos: hoveredWord.from,
    end: hoveredWord.to,
    above: false,
    strictSide: true,
    arrow: true,
    clip: false,
    create: () => ({
      dom: createSymbolHoverElement(symbol),
    }),
  }
}

function wordAtPosition(state: EditorState, pos: number): { from: number; to: number; text: string } | null {
  const line = state.doc.lineAt(pos)
  const offset = pos - line.from
  const left = line.text.slice(0, offset).match(/[A-Za-z_]\w*$/)?.[0] ?? ''
  const right = line.text.slice(offset).match(/^[A-Za-z_]\w*/)?.[0] ?? ''
  const text = `${left}${right}`

  if (!text) {
    return null
  }

  return {
    from: pos - left.length,
    to: pos + right.length,
    text,
  }
}

function findHoverSymbol(word: string, state: EditorState, from: number): ExportedSymbol | null {
  const line = state.doc.lineAt(from)
  const before = line.text.slice(0, from - line.from)
  const memberExpression = getMemberAccessAtCursor(before, '')?.expression ?? ''

  if (memberExpression) {
    const ownerType = inferExpressionType(memberExpression, state.doc.toString(), { cursorPosition: from })
    const owner = ownerType?.symbol
    const member = owner ? dedupeSymbolMembers([...owner.members, ...syntheticDataClassMembers(owner)]).find((item) => item.name === word) : undefined
    const stdlibMember = ownerType ? memberCatalogForType(ownerType).find((item) => item.label === word) : undefined

    if (owner && member) {
      return projectMemberToHoverSymbol(owner, member)
    }

    if (ownerType && stdlibMember) {
      return kotlinMemberToHoverSymbol(stdlibMember, ownerType)
    }
  }

  const sameFile = localSymbols.value.find((symbol) => symbol.fileId === activeFileId.value && symbol.name === word)

  if (sameFile) {
    return sameFile
  }

  const projectSymbol = localSymbols.value.find((symbol) => symbol.name === word || symbol.importPath.endsWith(`.${word}`))

  if (projectSymbol) {
    return projectSymbol
  }

  return kotlinDocToHoverSymbol(word)
}

function kotlinDocToHoverSymbol(word: string): ExportedSymbol | null {
  const doc = kotlinStdlibDocs[word] ?? kotlinLanguageDocs[word]

  if (!doc) {
    return null
  }

  return {
    fileId: `kotlin-doc-${word}`,
    filePath: `Kotlin · ${doc.section}`,
    packageName: 'kotlin',
    importPath: word,
    name: word,
    kind: doc.kind,
    signature: doc.signature,
    parameters: extractFunctionParameters(doc.signature),
    returnType: doc.returnType ?? '',
    implementation: '',
    documentation: doc.description,
    members: [],
  }
}

function projectMemberToHoverSymbol(owner: ExportedSymbol, member: SymbolMember): ExportedSymbol {
  return {
    ...owner,
    kind: member.kind,
    name: member.name,
    importPath: `${owner.importPath}.${member.name}`,
    signature: member.signature,
    parameters: extractFunctionParameters(member.signature),
    returnType: memberReturnType(member),
    implementation: member.signature,
    members: [],
  }
}

function kotlinMemberToHoverSymbol(member: KotlinMemberInfo, ownerType: KotlinTypeInfo): ExportedSymbol {
  const signature = specializeMemberSignature(member.signature, ownerType)
  const returnType = specializeMemberSignature(member.returnType ?? kotlinMemberInfoReturnType(member), ownerType)
  const documentation = member.description ?? kotlinMemberDescription(member, ownerType)

  return {
    fileId: 'kotlin-stdlib',
    filePath: `Kotlin stdlib · ${typeDisplayName(ownerType)}`,
    packageName: 'kotlin',
    importPath: `${typeDisplayName(ownerType)}.${member.label}`,
    name: member.label,
    kind: member.type === 'property' ? 'val' : 'fun',
    signature,
    parameters: extractFunctionParameters(signature),
    returnType,
    implementation: '',
    documentation,
    members: [],
  }
}

function kotlinMemberInfoReturnType(member: KotlinMemberInfo): string {
  return member.returnType ?? member.signature.match(/:\s*([^={]+)$/)?.[1]?.trim() ?? extractReturnType(member.signature)
}

function resolveQualifierSymbol(qualifier: string | undefined, content = activeFile.value?.content ?? ''): ExportedSymbol | undefined {
  if (!qualifier) {
    return undefined
  }

  const directSymbol = localSymbols.value.find(
    (symbol) => symbol.name === qualifier && ['class', 'object', 'interface'].includes(symbol.kind),
  )

  if (directSymbol) {
    return directSymbol
  }

  return inferIdentifierType(qualifier, content)?.symbol
}

function createSymbolHoverElement(symbol: ExportedSymbol): HTMLElement {
  const root = document.createElement('div')
  root.className = 'cm-kotlingo-hover'

  const signature = document.createElement('pre')
  signature.className = 'cm-kotlingo-hover-signature'
  signature.textContent = symbol.signature || `${symbol.kind} ${symbol.name}`
  root.append(signature)

  const meta = document.createElement('p')
  meta.className = 'cm-kotlingo-hover-meta'
  appendHoverChip(meta, symbol.kind)

  if (symbol.returnType) {
    appendHoverChip(meta, `returns ${symbol.returnType}`)
  }

  if (symbol.parameters.length > 0) {
    appendHoverChip(meta, `${symbol.parameters.length} params`)
  }

  appendHoverChip(meta, symbol.filePath)
  root.append(meta)

  if (symbol.documentation) {
    const doc = document.createElement('p')
    doc.className = 'cm-kotlingo-hover-doc'
    doc.textContent = symbol.documentation
    root.append(doc)
  }

  if (symbol.parameters.length > 0) {
    const title = document.createElement('p')
    const params = document.createElement('div')
    title.className = 'cm-kotlingo-hover-section-title'
    title.textContent = ['class', 'data class', 'interface'].includes(symbol.kind)
      ? 'constructor'
      : 'parameters'
    params.className = 'cm-kotlingo-hover-params'
    symbol.parameters.forEach((parameter) => {
      const row = document.createElement('code')
      row.textContent = parameter
      params.append(row)
    })
    root.append(title, params)
  }

  const hoverMembers = dedupeSymbolMembers([...symbol.members, ...syntheticDataClassMembers(symbol)])

  if (hoverMembers.length > 0) {
    const title = document.createElement('p')
    const members = document.createElement('div')
    title.className = 'cm-kotlingo-hover-section-title'
    title.textContent = 'members'
    members.className = 'cm-kotlingo-hover-members'
    hoverMembers.slice(0, 8).forEach((member) => {
      const row = document.createElement('code')
      row.textContent = member.signature
      members.append(row)
    })
    root.append(title, members)
  }

  if (symbol.implementation) {
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    const code = document.createElement('pre')

    summary.textContent = 'Показать реализацию'
    code.textContent = symbol.implementation
    details.append(summary, code)
    root.append(details)
  }

  return root
}

function appendHoverChip(container: HTMLElement, text: string) {
  const chip = document.createElement('span')
  chip.className = 'cm-kotlingo-hover-chip'
  chip.textContent = text
  container.append(chip)
}

function createDiagnosticsExtension(): Extension {
  const activePath = activeFilePath.value
  const activeDiagnostics = diagnostics.value.filter((diagnostic) => diagnostic.filePath === activePath)

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDiagnosticDecorations(view, activeDiagnostics)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDiagnosticDecorations(update.view, activeDiagnostics)
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  )
}

function buildDiagnosticDecorations(view: EditorView, activeDiagnostics: RuntimeDiagnostic[]): DecorationSet {
  const ranges: Range<Decoration>[] = []

  activeDiagnostics.forEach((diagnostic) => {
    const lineNumber = diagnostic.line ?? (diagnostic.interval ? diagnostic.interval.start.line + 1 : undefined)

    if (!lineNumber || lineNumber < 1 || lineNumber > view.state.doc.lines) {
      return
    }

    const line = view.state.doc.line(lineNumber)
    const severityClass = diagnostic.severity === 'ERROR' ? 'error' : 'warning'

    ranges.push(
      Decoration.line({
        class: `cm-kotlingo-diagnostic-line cm-kotlingo-diagnostic-line-${severityClass}`,
        attributes: { title: diagnostic.message },
      }).range(line.from),
    )

    if (!diagnostic.interval) {
      return
    }

    const startLine = view.state.doc.line(Math.min(view.state.doc.lines, diagnostic.interval.start.line + 1))
    const endLine = view.state.doc.line(Math.min(view.state.doc.lines, diagnostic.interval.end.line + 1))
    const from = Math.min(startLine.from + diagnostic.interval.start.ch, view.state.doc.length)
    const endCandidate = endLine.from + Math.max(diagnostic.interval.end.ch, diagnostic.interval.start.ch + 1)
    const to = Math.max(from + 1, Math.min(endCandidate, view.state.doc.length))

    ranges.push(
      Decoration.mark({
        class: `cm-kotlingo-diagnostic-mark cm-kotlingo-diagnostic-mark-${severityClass}`,
        attributes: { title: diagnostic.message },
      }).range(from, to),
    )
  })

  return Decoration.set(ranges, true)
}

function reconfigureDiagnostics() {
  editorView.value?.dispatch({
    effects: diagnosticsCompartment.reconfigure(createDiagnosticsExtension()),
  })
}

function replaceEditorDocument(content: string) {
  const view = editorView.value

  if (!view || view.state.doc.toString() === content) {
    return
  }

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  })
}

function setActiveFileContent(content: string) {
  const file = activeFile.value

  if (!file || file.content === content) {
    return
  }

  nodes.value = nodes.value.map((node) => (node.id === file.id ? { ...node, content } : node))
  scheduleRealtimeDiagnostics(content)
}

function scheduleRealtimeDiagnostics(content: string, delay = 140) {
  if (realtimeDiagnosticsTimer !== undefined) {
    window.clearTimeout(realtimeDiagnosticsTimer)
  }

  realtimeDiagnosticsTimer = window.setTimeout(() => {
    realtimeDiagnosticsTimer = undefined
    diagnostics.value = buildRealtimeDiagnostics(content)
  }, delay)
}

function buildRealtimeDiagnostics(content: string): RuntimeDiagnostic[] {
  const file = activeFile.value
  const filePath = activeFilePath.value

  if (!file || !filePath) {
    return []
  }

  return findUnresolvedMemberDiagnostics(content, file.name, filePath)
}

function findUnresolvedMemberDiagnostics(content: string, fileName: string, filePath: string): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = []
  const memberAccessRegex = /\b([A-Za-z_]\w*)\s*(?:\?\.|!!\.|\.)\s*([A-Za-z_]\w*)\b/g
  let match: RegExpExecArray | null

  while ((match = memberAccessRegex.exec(content)) !== null) {
    const receiverName = match[1]
    const memberName = match[2]
    const receiverOffset = match.index
    const memberOffset = match.index + match[0].lastIndexOf(memberName)

    if (
      isLikelyNonRuntimeMemberAccess(content, receiverOffset, receiverName, memberName) ||
      isOffsetInsideStringOrComment(content, receiverOffset)
    ) {
      continue
    }

    const receiverType = inferExpressionType(receiverName, content, { cursorPosition: memberOffset + memberName.length })

    if (!receiverType || receiverType.category === 'unknown') {
      continue
    }

    const availableMembers = memberNamesForType(receiverType)

    if (availableMembers.has(memberName)) {
      continue
    }

    const suggestion = closestMemberName(memberName, availableMembers)
    const start = editorPositionFromOffset(content, memberOffset)
    const end = editorPositionFromOffset(content, memberOffset + memberName.length)
    const typeName = typeDisplayName(receiverType)

    diagnostics.push({
      fileName,
      filePath,
      severity: 'ERROR',
      line: start.line + 1,
      column: start.ch + 1,
      interval: { start, end },
      message: suggestion
        ? `У типа ${typeName} нет свойства или метода ${memberName}. Возможно, вы имели в виду ${suggestion}.`
        : `У типа ${typeName} нет свойства или метода ${memberName}.`,
    })
  }

  return diagnostics
}

function isLikelyNonRuntimeMemberAccess(content: string, offset: number, receiverName: string, memberName: string): boolean {
  const lineStart = content.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  const lineEnd = content.indexOf('\n', offset)
  const line = content.slice(lineStart, lineEnd >= 0 ? lineEnd : content.length)
  const beforeAccess = line.slice(0, offset - lineStart)

  return (
    /^\s*(?:package|import)\s+/.test(line) ||
    /^\s*\/\//.test(line) ||
    /:\s*$/.test(beforeAccess) ||
    (/^[A-Z]/.test(receiverName) && /^[A-Z]/.test(memberName))
  )
}

function memberNamesForType(typeInfo: KotlinTypeInfo): Set<string> {
  return new Set([
    ...memberCatalogForType(typeInfo).map((member) => member.label),
    ...commonAnyMembers.map((member) => member.label),
    ...commonScopeMembers.map((member) => member.label),
    ...(typeInfo.symbol ? dedupeSymbolMembers([...typeInfo.symbol.members, ...syntheticDataClassMembers(typeInfo.symbol)]).map((member) => member.name) : []),
  ])
}

function closestMemberName(name: string, candidates: Set<string>): string {
  let best = ''
  let bestDistance = Number.POSITIVE_INFINITY

  candidates.forEach((candidate) => {
    const distance = levenshteinDistance(name.toLocaleLowerCase('en'), candidate.toLocaleLowerCase('en'))

    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  })

  return bestDistance <= Math.max(2, Math.floor(name.length / 3)) ? best : ''
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = Array.from({ length: right.length + 1 }, () => 0)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      )
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index]
    }
  }

  return previous[right.length]
}

function editorPositionFromOffset(content: string, offset: number): { line: number; ch: number } {
  const safeOffset = Math.max(0, Math.min(offset, content.length))
  const before = content.slice(0, safeOffset)
  const lineBreak = before.lastIndexOf('\n')
  const line = before.split('\n').length - 1

  return {
    line,
    ch: lineBreak >= 0 ? before.length - lineBreak - 1 : before.length,
  }
}

function isOffsetInsideStringOrComment(content: string, offset: number): boolean {
  let inLineComment = false
  let inBlockComment = false
  let inString = false
  let inChar = false
  let inTripleString = false

  for (let index = 0; index < Math.min(offset, content.length); index += 1) {
    const char = content[index]
    const next = content[index + 1]
    const previous = content[index - 1]

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
      }
      continue
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        index += 1
      }
      continue
    }

    if (inTripleString) {
      if (char === '"' && next === '"' && content[index + 2] === '"') {
        inTripleString = false
        index += 2
      }
      continue
    }

    if (inString) {
      if (char === '"' && previous !== '\\') {
        inString = false
      }
      continue
    }

    if (inChar) {
      if (char === "'" && previous !== '\\') {
        inChar = false
      }
      continue
    }

    if (char === '/' && next === '/') {
      inLineComment = true
      index += 1
      continue
    }

    if (char === '/' && next === '*') {
      inBlockComment = true
      index += 1
      continue
    }

    if (char === '"' && next === '"' && content[index + 2] === '"') {
      inTripleString = true
      index += 2
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "'") {
      inChar = true
    }
  }

  return inLineComment || inBlockComment || inString || inChar || inTripleString
}

function completionType(kind: string): string {
  const types: Record<string, string> = {
    class: 'class',
    'data class': 'class',
    interface: 'interface',
    object: 'constant',
    fun: 'function',
    keyword: 'keyword',
    modifier: 'keyword',
    literal: 'constant',
    val: 'variable',
    var: 'variable',
    typealias: 'type',
  }

  return types[kind] ?? 'text'
}

function applySymbolCompletionWithImport(view: EditorView, symbol: ExportedSymbol, from: number, to: number) {
  const importLine = `import ${symbol.importPath}\n`
  const importPosition = importInsertPosition(view.state.doc.toString())

  view.dispatch({ changes: { from: importPosition, insert: importLine } })

  const shift = importPosition <= from ? importLine.length : 0
  view.dispatch({
    changes: { from: from + shift, to: to + shift, insert: symbol.name },
    selection: { anchor: from + shift + symbol.name.length },
  })
}

function importInsertPosition(content: string): number {
  const lines = content.split('\n')
  let offset = 0
  let lastImportEnd = -1
  let packageEnd = -1

  lines.forEach((line) => {
    const lineEnd = offset + line.length + 1

    if (/^\s*package\s+/.test(line)) {
      packageEnd = lineEnd
    }

    if (/^\s*import\s+/.test(line)) {
      lastImportEnd = lineEnd
    }

    offset = lineEnd
  })

  if (lastImportEnd >= 0) {
    return lastImportEnd
  }

  if (packageEnd >= 0) {
    return packageEnd < content.length && content[packageEnd] === '\n' ? packageEnd + 1 : packageEnd
  }

  return 0
}

function createInlineSuggestionExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildInlineSuggestionDecorations(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
          this.decorations = buildInlineSuggestionDecorations(update.view)
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  )
}

function buildInlineSuggestionDecorations(view: EditorView): DecorationSet {
  const suggestion = bestInlineSuggestion(view.state)

  if (!suggestion || !view.hasFocus) {
    return Decoration.none
  }

  return Decoration.set([
    Decoration.widget({
      widget: new InlineSuggestionWidget(suggestion.suffix),
      side: 1,
    }).range(suggestion.to),
  ])
}

function bestInlineSuggestion(state: EditorState): InlineSuggestion | null {
  const range = state.selection.main

  if (!range.empty) {
    return null
  }

  const query = getCompletionQuery(state, range.head)

  if (!query || !query.prefix || query.mode === 'member') {
    return null
  }

  const option = rankCompletionOptions(buildCompletionOptions(query), query.prefix)[0]
  const insertText = completionInsertText(option)

  if (!option || !insertText.toLocaleLowerCase('en').startsWith(query.prefix.toLocaleLowerCase('en'))) {
    return null
  }

  const suffix = insertText.slice(query.prefix.length)

  if (!suffix) {
    return null
  }

  return {
    from: query.from,
    to: query.to,
    insertText,
    suffix,
  }
}

function acceptInlineSuggestion(view: EditorView): boolean {
  const suggestion = bestInlineSuggestion(view.state)

  if (!suggestion) {
    return false
  }

  view.dispatch({
    changes: { from: suggestion.from, to: suggestion.to, insert: suggestion.insertText },
    selection: { anchor: suggestion.from + suggestion.insertText.length },
  })

  return true
}

function completionInsertText(completion: Completion | undefined): string {
  if (!completion) {
    return ''
  }

  return typeof completion.apply === 'string' ? completion.apply : completion.label
}

function rankCompletionOptions(options: Completion[], prefix: string): Completion[] {
  return [...options]
    .filter((option) => fuzzyCompletionScore(completionInsertText(option), prefix) > 0)
    .sort((first, second) => {
      const firstScore = fuzzyCompletionScore(completionInsertText(first), prefix) + (first.boost ?? 0)
      const secondScore = fuzzyCompletionScore(completionInsertText(second), prefix) + (second.boost ?? 0)

      return secondScore - firstScore || first.label.localeCompare(second.label, 'en')
    })
}

function fuzzyCompletionScore(candidate: string, prefix: string): number {
  const normalizedCandidate = candidate.toLocaleLowerCase('en')
  const normalizedPrefix = prefix.toLocaleLowerCase('en')

  if (!normalizedPrefix) {
    return 1
  }

  if (normalizedCandidate === normalizedPrefix) {
    return 500
  }

  if (normalizedCandidate.startsWith(normalizedPrefix)) {
    return 420 - normalizedCandidate.length
  }

  if (normalizedCandidate.includes(normalizedPrefix)) {
    return 260 - normalizedCandidate.indexOf(normalizedPrefix)
  }

  let candidateIndex = 0
  let score = 120

  for (const char of normalizedPrefix) {
    const foundIndex = normalizedCandidate.indexOf(char, candidateIndex)

    if (foundIndex === -1) {
      return 0
    }

    score -= foundIndex - candidateIndex
    candidateIndex = foundIndex + 1
  }

  return Math.max(1, score)
}

class InlineSuggestionWidget extends WidgetType {
  private readonly text: string

  constructor(text: string) {
    super()
    this.text = text
  }

  eq(other: InlineSuggestionWidget): boolean {
    return other.text === this.text
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-kotlingo-inline-suggestion'
    element.textContent = this.text

    return element
  }

  ignoreEvent(): boolean {
    return true
  }
}

function openFile(fileId: string) {
  if (!openFileIds.value.includes(fileId)) {
    openFileIds.value = [...openFileIds.value, fileId]
  }
}

function activateFile(fileId: string) {
  const file = files.value.find((item) => item.id === fileId)

  if (!file) {
    return
  }

  selectedNodeId.value = file.id
  activeFileId.value = file.id
  openFile(file.id)
}

function closeFileTab(fileId: string) {
  const currentIndex = openFileIds.value.indexOf(fileId)
  const nextOpenFileIds = openFileIds.value.filter((id) => id !== fileId)

  openFileIds.value = nextOpenFileIds

  if (activeFileId.value !== fileId) {
    return
  }

  const fallbackFileId = nextOpenFileIds[Math.max(0, currentIndex - 1)] ?? nextOpenFileIds[0] ?? files.value[0]?.id

  if (fallbackFileId) {
    activateFile(fallbackFileId)
  }
}

function formatActiveFile() {
  const file = activeFile.value

  if (!file) {
    return
  }

  const formatted = formatKotlinCode(file.content)
  setActiveFileContent(formatted)
  replaceEditorDocument(formatted)
}

function revealDiagnostic(diagnostic: RuntimeDiagnostic) {
  const targetFile = files.value.find((file) => getNodePath(file.id, nodes.value) === diagnostic.filePath)

  if (!targetFile) {
    return
  }

  activateFile(targetFile.id)

  nextTick(() => {
    const view = editorView.value
    const lineNumber = diagnostic.line ?? 1

    if (!view || lineNumber < 1 || lineNumber > view.state.doc.lines) {
      return
    }

    const line = view.state.doc.line(lineNumber)
    const anchor = Math.min(line.to, line.from + Math.max(0, (diagnostic.column ?? 1) - 1))

    view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
    })
    view.focus()
  })
}

function appendVisibleChildren(parentId: string, depth: number, result: VisibleNode[]) {
  nodes.value
    .filter((node) => node.parentId === parentId)
    .sort(sortSandboxNodes)
    .forEach((node) => {
      result.push({ node, depth })

      if (isFolderNode(node) && expandedFolderIds.value.includes(node.id)) {
        appendVisibleChildren(node.id, depth + 1, result)
      }
    })
}

function appendSearchVisibleChildren(parentId: string, depth: number, result: VisibleNode[]) {
  nodes.value
    .filter((node) => node.parentId === parentId)
    .sort(sortSandboxNodes)
    .forEach((node) => {
      const matches = nodeMatchesFileSearch(node)
      const hasMatchingChildren = isFolderNode(node) && folderHasSearchMatch(node.id)

      if (!matches && !hasMatchingChildren) {
        return
      }

      result.push({ node, depth })

      if (isFolderNode(node)) {
        appendSearchVisibleChildren(node.id, depth + 1, result)
      }
    })
}

function nodeMatchesFileSearch(node: SandboxNode): boolean {
  const query = normalizedFileSearchQuery.value

  if (!query) {
    return true
  }

  const path = getNodePath(node.id, nodes.value).toLocaleLowerCase('ru')
  const name = node.name.toLocaleLowerCase('ru')
  const content = isFileNode(node) ? node.content.toLocaleLowerCase('ru') : ''

  return name.includes(query) || path.includes(query) || content.includes(query)
}

function folderHasSearchMatch(folderId: string): boolean {
  return getDescendantIds(folderId, nodes.value).some((nodeId) => {
    const node = nodeMap.value.get(nodeId)

    return Boolean(node && nodeMatchesFileSearch(node))
  })
}

function selectNode(node: SandboxNode) {
  selectedNodeId.value = node.id

  if (isFileNode(node)) {
    activeFileId.value = node.id
    return
  }

  toggleFolder(node.id)
}

function handleTreeDragStart(event: DragEvent, node: SandboxNode) {
  if (node.id === ROOT_ID) {
    return
  }

  draggedNodeId.value = node.id
  event.dataTransfer?.setData('text/plain', node.id)
  event.dataTransfer?.setData('application/x-kotlingo-node', node.id)

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function handleTreeDragOver(event: DragEvent, targetNode: SandboxNode) {
  const draggedNode = nodeMap.value.get(draggedNodeId.value)
  const targetParentId = dropParentIdForNode(targetNode)

  if (!draggedNode || !targetParentId || !canMoveNode(draggedNode, targetParentId)) {
    return
  }

  event.preventDefault()
  dragTargetNodeId.value = targetNode.id

  if (isFolderNode(targetNode)) {
    expandFolder(targetNode.id)
  }
}

function handleTreeDrop(event: DragEvent, targetNode: SandboxNode) {
  event.preventDefault()

  const draggedNode = nodeMap.value.get(draggedNodeId.value)
  const targetParentId = dropParentIdForNode(targetNode)

  if (draggedNode && targetParentId && canMoveNode(draggedNode, targetParentId)) {
    moveNodeToFolder(draggedNode, targetParentId)
  }

  clearTreeDragState()
}

function clearTreeDragState() {
  draggedNodeId.value = ''
  dragTargetNodeId.value = ''
}

function dropParentIdForNode(node: SandboxNode): string | null {
  return isFolderNode(node) ? node.id : node.parentId
}

function canMoveNode(node: SandboxNode, targetParentId: string): boolean {
  if (node.id === ROOT_ID || node.parentId === targetParentId || node.id === targetParentId) {
    return false
  }

  if (isFolderNode(node) && getDescendantIds(node.id, nodes.value).includes(targetParentId)) {
    return false
  }

  return Boolean(nodeMap.value.get(targetParentId))
}

function moveNodeToFolder(node: SandboxNode, targetParentId: string) {
  nodes.value = moveSandboxNodeToFolder(nodes.value, node.id, targetParentId).nodes
  selectedNodeId.value = node.id
  expandFolder(targetParentId)
}

function toggleFolder(folderId: string) {
  if (expandedFolderIds.value.includes(folderId)) {
    expandedFolderIds.value = expandedFolderIds.value.filter((id) => id !== folderId)
  } else {
    expandedFolderIds.value = [...expandedFolderIds.value, folderId]
  }
}

function createFile() {
  const parentId = selectedFolder.value?.id ?? ROOT_ID
  const packageName = packageNameFromFolder(parentId, nodes.value)
  const name = makeUniqueNodeName(parentId, nodes.value, normalizeFileName('File.kt'))
  const file: SandboxFileNode = {
    id: createNodeId('file'),
    parentId,
    name,
    kind: 'file',
    content: sourceForNewKotlinFile(packageName),
  }

  nodes.value = [...nodes.value, file]
  selectedNodeId.value = file.id
  activeFileId.value = file.id
  expandFolder(parentId)
}

function createFolder() {
  const parentId = selectedFolder.value?.id ?? ROOT_ID
  const name = makeUniqueNodeName(parentId, nodes.value, normalizeFolderName('folder'))
  const folder: SandboxFolderNode = {
    id: createNodeId('folder'),
    parentId,
    name,
    kind: 'folder',
  }

  nodes.value = [...nodes.value, folder]
  selectedNodeId.value = folder.id
  expandFolder(parentId)
}

function deleteSelectedNode() {
  const node = selectedNode.value

  if (!node || node.id === ROOT_ID || !window.confirm(`Удалить ${node.name}?`)) {
    return
  }

  const deleteIds = new Set([node.id, ...(isFolderNode(node) ? getDescendantIds(node.id, nodes.value) : [])])
  nodes.value = nodes.value.filter((item) => !deleteIds.has(item.id))
  expandedFolderIds.value = expandedFolderIds.value.filter((id) => !deleteIds.has(id))
  openFileIds.value = openFileIds.value.filter((id) => !deleteIds.has(id))

  const nextFile = files.value.find((file) => !deleteIds.has(file.id))
  selectedNodeId.value = nextFile?.id ?? ROOT_ID
  activeFileId.value = nextFile?.id ?? ''

  if (nextFile && openFileIds.value.length === 0) {
    openFileIds.value = [nextFile.id]
  }
}

function commitRename() {
  const node = selectedNode.value

  if (!node || node.id === ROOT_ID) {
    return
  }

  const nextProject = renameSandboxNode(nodes.value, node.id, renameDraft.value)
  const renamedNode = nextProject.nodes.find((item) => item.id === node.id)

  nodes.value = nextProject.nodes
  renameDraft.value = renamedNode?.name ?? renameDraft.value
}

async function runProject() {
  if (runStatus.value === 'running') {
    return
  }

  if (realtimeDiagnosticsTimer !== undefined) {
    window.clearTimeout(realtimeDiagnosticsTimer)
    realtimeDiagnosticsTimer = undefined
  }

  runStatus.value = 'running'
  diagnostics.value = []
  runOutput.value = 'Compiling...'

  try {
    const version = await ensureCompilerVersion()
    const preparedProject = prepareCompilerProject(
      files.value.map((file) => ({
        path: getNodePath(file.id, nodes.value),
        content: file.content,
      })),
    )
    const response = await runKotlinProject(preparedProject.files, version, programArgs.value)
    const nextDiagnostics = flattenCompilerDiagnostics(response, preparedProject.fileNameToPath)
    const compilerText = cleanCompilerText(response.text)
    const exceptionText = formatCompilerException(response.exception)
    const hasErrors = nextDiagnostics.some((diagnostic) => diagnostic.severity === 'ERROR') || Boolean(response.exception)

    diagnostics.value = nextDiagnostics
    runOutput.value = [compilerText, exceptionText].filter(Boolean).join('\n') || 'Program finished without output.'
    runStatus.value = hasErrors ? 'error' : 'success'
    lastRunAt.value = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch (error) {
    diagnostics.value = []
    runStatus.value = 'error'
    runOutput.value = error instanceof Error ? error.message : 'Kotlin compiler request failed.'
  }
}

async function ensureCompilerVersion(): Promise<string> {
  if (selectedCompilerVersion.value !== LATEST_VERSION_VALUE) {
    return selectedCompilerVersion.value
  }

  if (compilerVersions.value.length === 0) {
    await loadCompilerVersions()
  }

  return latestStableVersion.value || FALLBACK_KOTLIN_VERSION
}

async function loadCompilerVersions() {
  compilerVersionsLoading.value = true
  compilerVersionsError.value = ''

  try {
    compilerVersions.value = await fetchKotlinCompilerVersions()
  } catch (error) {
    compilerVersionsError.value = error instanceof Error ? error.message : 'Не удалось загрузить версии Kotlin.'
  } finally {
    compilerVersionsLoading.value = false
  }
}

function resolveImport(importItem: KotlinImport): ImportResolution {
  if (importItem.path.endsWith('.*')) {
    const packageName = importItem.path.slice(0, -2)
    const hasLocalPackage = exportedSymbols.value.some((symbol) => symbol.packageName === packageName)

    return {
      ...importItem,
      status: hasLocalPackage || isKnownExternalImport(importItem.path) ? 'wildcard' : 'missing',
    }
  }

  const localSymbol = exportedSymbols.value.find((symbol) => symbol.importPath === importItem.path)

  if (localSymbol) {
    return {
      ...importItem,
      status: 'resolved',
      targetFilePath: localSymbol.filePath,
    }
  }

  return {
    ...importItem,
    status: isKnownExternalImport(importItem.path) ? 'external' : 'missing',
  }
}

function insertImport(importPath: string) {
  const file = activeFile.value

  if (!file || parseKotlinImports(file.content).some((importItem) => importItem.path === importPath)) {
    return
  }

  const lines = file.content.split('\n')
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
  nodes.value = nodes.value.map((node) => (node.id === file.id ? { ...node, content: lines.join('\n') } : node))
}

async function copyImport(importPath: string) {
  await navigator.clipboard?.writeText(`import ${importPath}`)
  copiedImportPath.value = importPath
  window.setTimeout(() => {
    if (copiedImportPath.value === importPath) {
      copiedImportPath.value = ''
    }
  }, 1400)
}

function resetProject() {
  if (!window.confirm('Сбросить песочницу к начальному примеру?')) {
    return
  }

  nodes.value = createDefaultProject()
  activeFileId.value = DEFAULT_ACTIVE_FILE_ID
  selectedNodeId.value = DEFAULT_ACTIVE_FILE_ID
  openFileIds.value = [DEFAULT_ACTIVE_FILE_ID]
  expandedFolderIds.value = [...defaultExpandedFolderIds]
  runStatus.value = 'idle'
  diagnostics.value = []
  runOutput.value = 'Нажмите «Запустить», чтобы собрать проект на актуальном Kotlin compiler backend.'
}

function expandFolder(folderId: string) {
  if (!expandedFolderIds.value.includes(folderId)) {
    expandedFolderIds.value = [...expandedFolderIds.value, folderId]
  }
}

function treeNodeStyle(depth: number) {
  return { paddingLeft: `${10 + depth * 16}px` }
}

function importStatusLabel(status: ImportStatus): string {
  const labels: Record<ImportStatus, string> = {
    resolved: 'local',
    external: 'sdk',
    wildcard: 'package',
    missing: 'missing',
  }

  return labels[status]
}

function importStatusClass(status: ImportStatus): string {
  if (status === 'missing') {
    return 'inline-flex min-h-6 items-center rounded-full bg-rose/12 px-2 text-[11px] font-black text-rose'
  }

  if (status === 'external') {
    return tagBase.middle
  }

  return tagBase.beginner
}

function isKnownExternalImport(importPath: string): boolean {
  return ['kotlin.', 'java.', 'javax.'].some((prefix) => importPath.startsWith(prefix))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function loadPersistedState() {
  const rawState = window.localStorage.getItem(STORAGE_KEY)

  if (!rawState) {
    return
  }

  try {
    const state = JSON.parse(rawState) as StoredSandboxState

    if (!isStoredStateValid(state)) {
      return
    }

    nodes.value = state.nodes
    activeFileId.value = state.activeFileId
    selectedNodeId.value = state.selectedNodeId
    openFileIds.value = state.openFileIds?.filter((fileId) => state.nodes.some((node) => node.id === fileId && node.kind === 'file')) ?? [
      state.activeFileId,
    ]
    expandedFolderIds.value = state.expandedFolderIds
    selectedCompilerVersion.value = state.compilerVersion
    programArgs.value = state.args
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
  }
}

function persistState() {
  const state: StoredSandboxState = {
    nodes: nodes.value,
    activeFileId: activeFileId.value,
    selectedNodeId: selectedNodeId.value,
    openFileIds: openFileIds.value,
    expandedFolderIds: expandedFolderIds.value,
    compilerVersion: selectedCompilerVersion.value,
    args: programArgs.value,
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function isStoredStateValid(state: StoredSandboxState): boolean {
  return (
    Array.isArray(state.nodes) &&
    state.nodes.some((node) => node.id === ROOT_ID && node.kind === 'folder') &&
    state.nodes.some(isFileNode) &&
    typeof state.activeFileId === 'string' &&
    typeof state.selectedNodeId === 'string' &&
    Array.isArray(state.expandedFolderIds)
  )
}
</script>

<template>
  <div :class="layout.page">
    <CourseTopBar>
      <div class="flex min-w-0 items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-card border border-accent/35 bg-accent/15 text-accent shadow-glow max-sm:h-8 max-sm:w-8">
          <Code2 :size="22" />
        </div>
        <div class="min-w-0">
          <p class="m-0 text-[11px] font-black uppercase tracking-wide text-muted max-sm:hidden">Kotlin browser IDE</p>
          <h1 class="m-0 truncate text-2xl font-black leading-none max-sm:text-xl">Песочница Kotlin</h1>
        </div>
      </div>

      <div class="grid min-w-0 gap-1 text-sm font-extrabold text-muted max-lg:hidden">
        <span>{{ projectStats.files }} файлов / {{ projectStats.folders }} папок</span>
        <span class="truncate text-xs text-muted-soft">Compiler {{ resolvedCompilerVersion || FALLBACK_KOTLIN_VERSION }}</span>
      </div>

      <div class="flex items-center gap-2">
        <RouterLink to="/" :class="[buttons.secondary, 'hidden xl:inline-flex']">
          <Home :size="18" />
          <span>Главная</span>
        </RouterLink>
        <RouterLink to="/kotlin" :class="[buttons.secondary, 'hidden sm:inline-flex']">
          <span>Kotlin курс</span>
        </RouterLink>
        <Button :class="buttons.primary" :disabled="runStatus === 'running'" title="Запустить проект" @click="runProject">
          <Loader2 v-if="runStatus === 'running'" class="animate-spin" :size="18" />
          <Play v-else :size="18" />
          <span class="max-sm:hidden">Запустить</span>
        </Button>
      </div>
    </CourseTopBar>

    <div class="mx-auto grid w-full max-w-[var(--page-max)] grid-cols-[300px_minmax(0,1fr)] items-start gap-5 px-6 py-5 pb-12 max-xl:block max-xl:px-3">
      <aside :class="[layout.panel, 'sticky top-[92px] flex max-h-[calc(100vh-112px)] flex-col overflow-hidden max-xl:static max-xl:max-h-none']">
        <div class="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Project</p>
            <strong class="text-lg font-black">Файлы</strong>
          </div>
          <div class="flex items-center gap-2">
            <Button :class="buttons.icon" title="Создать папку" aria-label="Создать папку" @click="createFolder">
              <FolderPlus :size="18" />
            </Button>
            <Button :class="buttons.icon" title="Создать файл" aria-label="Создать файл" @click="createFile">
              <FilePlus2 :size="18" />
            </Button>
          </div>
        </div>

        <div class="grid gap-2 border-b border-line px-4 py-3">
          <label :class="form.search">
            <Search :size="17" />
            <InputText v-model="fileSearchQuery" :class="form.input" placeholder="Поиск по файлам" />
          </label>
          <span v-if="normalizedFileSearchQuery" class="text-xs font-bold text-muted">
            {{ visibleFileCount }} совпадений
          </span>
        </div>

        <nav class="grid gap-1 overflow-auto p-2" aria-label="Файлы песочницы" @dragend="clearTreeDragState">
          <button
            v-for="item in visibleNodes"
            :key="item.node.id"
            :class="[
              'grid min-h-10 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-card border py-2 pr-2 text-left transition',
              selectedNode?.id === item.node.id
                ? 'border-accent/45 bg-accent/12 text-ink'
                : dragTargetNodeId === item.node.id
                  ? 'border-accent/60 bg-accent/10 text-ink shadow-glow'
                : 'border-transparent text-ink/78 hover:border-line hover:bg-panel-soft',
            ]"
            :style="treeNodeStyle(item.depth)"
            :draggable="item.node.id !== ROOT_ID"
            type="button"
            @dragstart="handleTreeDragStart($event, item.node)"
            @dragover="handleTreeDragOver($event, item.node)"
            @dragleave="dragTargetNodeId = ''"
            @drop="handleTreeDrop($event, item.node)"
            @click="selectNode(item.node)"
          >
            <ChevronDown v-if="isFolderNode(item.node) && expandedFolderIds.includes(item.node.id)" class="text-muted" :size="16" />
            <ChevronRight v-else-if="isFolderNode(item.node)" class="text-muted" :size="16" />
            <FileCode2 v-else class="text-accent" :size="16" />
            <span class="flex min-w-0 items-center gap-2">
              <FolderOpen v-if="isFolderNode(item.node) && expandedFolderIds.includes(item.node.id)" class="text-amber" :size="16" />
              <Folder v-else-if="isFolderNode(item.node)" class="text-amber" :size="16" />
              <span class="truncate text-sm font-bold">{{ item.node.name }}</span>
            </span>
          </button>
        </nav>

        <div class="grid gap-3 border-t border-line p-4">
          <div class="grid gap-2">
            <label class="text-xs font-black uppercase tracking-wide text-muted" for="sandbox-node-name">Имя</label>
            <InputText
              id="sandbox-node-name"
              v-model="renameDraft"
              class="min-h-10 rounded-control border border-line bg-app-soft px-3 text-sm font-bold text-ink outline-none transition focus:border-accent/60"
              :disabled="!selectedNode || selectedNode.id === ROOT_ID"
              @blur="commitRename"
              @keydown.enter.prevent="commitRename"
            />
          </div>
          <Button :class="[buttons.secondary, 'justify-center text-rose hover:border-rose/45 hover:bg-rose/10']" :disabled="!canDeleteSelected" @click="deleteSelectedNode">
            <Trash2 :size="17" />
            <span>Удалить</span>
          </Button>
        </div>
      </aside>

      <main class="grid min-w-0 gap-4 max-xl:mt-4">
        <section :class="[layout.panel, 'min-w-0 overflow-hidden']">
        <header class="flex items-center justify-between gap-4 border-b border-line px-5 py-4 max-sm:flex-col max-sm:items-start">
          <div class="min-w-0">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Active file</p>
            <h2 class="m-0 mt-1 truncate text-2xl font-black">{{ activeFilePath || 'No file selected' }}</h2>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Tag v-if="activePackage" :value="activePackage" :class="tagBase.beginner" />
            <Tag v-else value="default package" :class="tagBase.default" />
            <Button :class="buttons.secondary" title="Форматировать код" @click="formatActiveFile">
              <Wand2 :size="17" />
              <span>Форматировать</span>
            </Button>
          </div>
        </header>

        <div class="flex min-h-12 items-center gap-1 overflow-x-auto border-b border-line bg-app-soft px-2 py-2">
          <div
            v-for="file in openFiles"
            :key="file.id"
            :class="[
              'grid min-w-40 grid-cols-[minmax(0,1fr)_30px] items-center overflow-hidden rounded-card border transition',
              file.id === activeFile?.id
                ? 'border-accent/45 bg-accent/12 text-ink'
                : 'border-line bg-panel hover:border-line-strong hover:bg-panel-soft',
            ]"
          >
            <button class="flex min-w-0 items-center gap-2 px-3 py-2 text-left" type="button" @click="activateFile(file.id)">
              <FileCode2 class="text-accent" :size="15" />
              <span class="truncate text-sm font-black">{{ file.name }}</span>
            </button>
            <button
              class="grid h-full place-items-center text-muted transition hover:bg-rose/10 hover:text-rose"
              type="button"
              title="Закрыть вкладку"
              aria-label="Закрыть вкладку"
              @click.stop="closeFileTab(file.id)"
            >
              <X :size="15" />
            </button>
          </div>
          <div v-if="openFiles.length === 0" class="px-3 text-sm font-bold text-muted">Откройте файл из дерева проекта</div>
        </div>

        <div class="overflow-hidden bg-app-soft">
          <div ref="editorHostRef" class="min-h-[min(68vh,760px)]"></div>
        </div>
        </section>

        <SandboxRunPanel
          v-model:selected-compiler-version="selectedCompilerVersion"
          v-model:program-args="programArgs"
          :compiler-version-options="compilerVersionOptions"
          :run-status="runStatus"
          :run-output="runOutput"
          :last-run-at="lastRunAt"
          :compiler-versions-error="compilerVersionsError"
          :compiler-versions-loading="compilerVersionsLoading"
          @run="runProject"
        />

        <SandboxDiagnosticsPanel
          :diagnostics="diagnostics"
          :compiler-error-count="compilerErrorCount"
          :run-status="runStatus"
          @reveal="revealDiagnostic"
        />

        <section :class="[layout.panel, 'grid gap-4 p-4']">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Imports</p>
              <h2 class="m-0 mt-1 text-xl font-black">{{ exportedSymbols.length }} symbols</h2>
            </div>
            <Button :class="buttons.icon" title="Сбросить пример" aria-label="Сбросить пример" @click="resetProject">
              <RotateCcw :size="18" />
            </Button>
          </div>

          <div class="grid gap-2">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Текущий файл</p>
            <div v-if="currentImports.length === 0" class="rounded-card border border-line bg-app-soft p-3 text-sm font-bold text-muted">
              Import-строк пока нет.
            </div>
            <div v-else class="grid gap-2">
              <div v-for="importItem in currentImports" :key="`${importItem.path}-${importItem.alias ?? ''}`" class="grid gap-2 rounded-card border border-line bg-app-soft p-3">
                <div class="flex items-center justify-between gap-2">
                  <code class="min-w-0 truncate font-mono text-xs text-ink">{{ importItem.path }}</code>
                  <Tag :value="importStatusLabel(importItem.status)" :class="importStatusClass(importItem.status)" />
                </div>
                <span v-if="importItem.targetFilePath" class="truncate text-xs font-bold text-muted">{{ importItem.targetFilePath }}</span>
              </div>
            </div>
          </div>

          <div class="grid gap-2">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Можно импортировать</p>
            <div v-if="exportedSymbols.length === 0" class="rounded-card border border-line bg-app-soft p-3 text-sm font-bold text-muted">
              Добавьте `package` и объявления в соседних файлах.
            </div>
            <div v-else class="grid max-h-64 gap-2 overflow-auto">
              <div v-for="symbol in exportedSymbols" :key="`${symbol.fileId}-${symbol.importPath}`" class="grid gap-2 rounded-card border border-line bg-app-soft p-3">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <strong class="block truncate text-sm font-black text-ink">{{ symbol.name }}</strong>
                    <code class="block truncate font-mono text-xs text-muted">{{ symbol.importPath }}</code>
                  </div>
                  <Tag :value="symbol.kind" :class="tagBase.default" />
                </div>
                <div class="flex items-center gap-2">
                  <Button :class="[buttons.subtle, 'min-h-8 px-2 text-xs']" @click="insertImport(symbol.importPath)">
                    <ChevronRight :size="15" />
                    <span>Вставить</span>
                  </Button>
                  <Button :class="[buttons.icon, 'h-8 w-8']" :title="copiedImportPath === symbol.importPath ? 'Скопировано' : 'Скопировать import'" @click="copyImport(symbol.importPath)">
                    <Copy :size="15" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <p v-if="unresolvedImports.length > 0" class="m-0 text-xs font-bold leading-5 text-rose">
            {{ unresolvedImports.length }} import не найден в проекте или SDK.
          </p>
        </section>
      </main>
    </div>
  </div>
</template>
