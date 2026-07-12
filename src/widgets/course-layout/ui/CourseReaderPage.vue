<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Component } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Filter,
  Heart,
  Home,
  LayoutList,
  Menu,
  Play,
  Search,
} from '@lucide/vue'
import Button from 'primevue/button'
import Drawer from 'primevue/drawer'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import AppSelect from '@/shared/ui/AppSelect.vue'
import SearchField from '@/shared/ui/SearchField.vue'
import CourseTopBar from '@/widgets/course-layout/ui/CourseTopBar.vue'
import type { CourseLesson, CourseModule, CourseStats } from '@/entities/course/model/course'
import { useCourseProgressStore } from '@/entities/course/model/courseProgress'
import { markdown } from '@/shared/config/markdown'
import { buttons, drawerPt, layout, progressPt, tagBase } from '@/shared/config/ui'

interface FilterOption {
  label: string
  value: string
}

interface CourseReaderLink {
  label: string
  to: string
}

interface CourseReaderProps {
  eyebrow: string
  title: string
  lessons: CourseLesson[]
  modules: CourseModule[]
  categories: string[]
  difficulties: string[]
  stats: CourseStats
  switchLink: CourseReaderLink
  brandImageSrc?: string
  brandIcon?: Component
  brandIconClass?: string
}

const props = defineProps<CourseReaderProps>()
const allOption = 'all'
const courseLessons = props.lessons
const courseModules = props.modules
const courseCategories = props.categories
const courseDifficulties = props.difficulties
const courseStats = props.stats
const firstLesson = courseLessons[0]

if (!firstLesson) {
  throw new Error('Course lessons were not found.')
}

const progress = useCourseProgressStore()
const query = ref('')
const categoryFilter = ref(allOption)
const difficultyFilter = ref(allOption)
const completionFilter = ref<'all' | 'todo' | 'done'>('all')
const favoritesOnly = ref(false)
const mobileNavOpen = ref(false)
const selectedLessonId = ref(lessonIdFromHash() ?? firstLesson.id)
const activeHeadingId = ref('')
const lessonIdSet = new Set(courseLessons.map((lesson) => lesson.id))
let activeHeadingFrame = 0

const categoryOptions = computed<FilterOption[]>(() => [
  { label: 'Все темы', value: allOption },
  ...courseCategories.map((category) => ({ label: category, value: category })),
])

const difficultyOptions = computed<FilterOption[]>(() => [
  { label: 'Любая сложность', value: allOption },
  ...courseDifficulties.map((difficulty) => ({ label: difficulty, value: difficulty })),
])

const completionOptions: FilterOption[] = [
  { label: 'Все уроки', value: 'all' },
  { label: 'Не пройдены', value: 'todo' },
  { label: 'Пройдены', value: 'done' },
]

const filteredLessons = computed(() => courseLessons.filter((lesson) => lessonMatchesFilters(lesson)))

const visibleModules = computed<CourseModule[]>(() =>
  courseModules
    .map((module) => ({
      ...module,
      lessons: module.lessons.filter((lesson) => filteredLessons.value.includes(lesson)),
    }))
    .filter((module) => module.lessons.length > 0),
)

const currentLesson = computed<CourseLesson>(
  () => courseLessons.find((lesson) => lesson.id === selectedLessonId.value) ?? firstLesson,
)

const currentLessonIndex = computed(() =>
  Math.max(
    0,
    courseLessons.findIndex((lesson) => lesson.id === currentLesson.value.id),
  ),
)

const currentModule = computed<CourseModule>(
  () => courseModules.find((module) => module.title === currentLesson.value.category) ?? courseModules[0],
)

const previousLesson = computed(() => courseLessons[currentLessonIndex.value - 1])
const nextLesson = computed(() => courseLessons[currentLessonIndex.value + 1])
const nextIncompleteLesson = computed(() => courseLessons.find((lesson) => !progress.isCompleted(lesson.id)) ?? firstLesson)
const currentLessonCompleted = computed(() => progress.isCompleted(currentLesson.value.id))
const currentLessonFavorite = computed(() => progress.isFavorite(currentLesson.value.id))
const completedCount = computed(
  () => progress.completedLessonIds.filter((lessonId) => lessonIdSet.has(lessonId)).length,
)
const completionPercent = computed(() => Math.round((completedCount.value / courseStats.lessonCount) * 100))
const visibleLessonCount = computed(() => filteredLessons.value.length)
const hasActiveFilters = computed(
  () =>
    query.value.trim().length > 0 ||
    categoryFilter.value !== allOption ||
    difficultyFilter.value !== allOption ||
    completionFilter.value !== 'all' ||
    favoritesOnly.value,
)

const upcomingLessons = computed(() => {
  const moduleLessons = currentModule.value.lessons
  const index = moduleLessons.findIndex((lesson) => lesson.id === currentLesson.value.id)
  const nextInModule = moduleLessons.slice(index + 1, index + 4)

  if (nextInModule.length > 0) {
    return nextInModule
  }

  return courseLessons.slice(currentLessonIndex.value + 1, currentLessonIndex.value + 4)
})

onMounted(() => {
  window.addEventListener('hashchange', syncLessonFromHash)
  window.addEventListener('scroll', queueActiveHeadingUpdate, { passive: true })

  if (!window.location.hash.startsWith('#lesson/')) {
    replaceLessonHash(currentLesson.value)
  }

  nextTick(updateActiveHeading)
})

onUnmounted(() => {
  window.removeEventListener('hashchange', syncLessonFromHash)
  window.removeEventListener('scroll', queueActiveHeadingUpdate)
  cancelAnimationFrame(activeHeadingFrame)
})

watch(currentLesson, () => {
  activeHeadingId.value = currentLesson.value.headings[0]?.id ?? ''
  nextTick(updateActiveHeading)
})

function lessonMatchesFilters(lesson: CourseLesson): boolean {
  const normalizedQuery = query.value.trim().toLocaleLowerCase('ru')
  const matchesQuery =
    normalizedQuery.length === 0 ||
    [lesson.title, lesson.description, lesson.category, lesson.difficulty]
      .join(' ')
      .toLocaleLowerCase('ru')
      .includes(normalizedQuery)
  const matchesCategory = categoryFilter.value === allOption || lesson.category === categoryFilter.value
  const matchesDifficulty = difficultyFilter.value === allOption || lesson.difficulty === difficultyFilter.value
  const matchesCompletion =
    completionFilter.value === 'all' ||
    (completionFilter.value === 'done' && progress.isCompleted(lesson.id)) ||
    (completionFilter.value === 'todo' && !progress.isCompleted(lesson.id))
  const matchesFavorite = !favoritesOnly.value || progress.isFavorite(lesson.id)

  return matchesQuery && matchesCategory && matchesDifficulty && matchesCompletion && matchesFavorite
}

function selectLesson(lesson: CourseLesson) {
  selectedLessonId.value = lesson.id
  mobileNavOpen.value = false
  replaceLessonHash(lesson)

  nextTick(() => {
    document.getElementById('lesson-top')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })
}

function selectCategory(category: string) {
  categoryFilter.value = category
}

function clearFilters() {
  query.value = ''
  categoryFilter.value = allOption
  difficultyFilter.value = allOption
  completionFilter.value = 'all'
  favoritesOnly.value = false
}

function moduleCompletion(module: CourseModule): { completed: number; percent: number } {
  const completed = module.lessons.filter((lesson) => progress.isCompleted(lesson.id)).length

  return {
    completed,
    percent: Math.round((completed / module.lessons.length) * 100),
  }
}

function formatOrder(order: number): string {
  return String(order).padStart(2, '0')
}

function difficultyClass(difficulty: string): string {
  const classes: Record<string, string> = {
    Начальный: tagBase.beginner,
    Средний: tagBase.middle,
    Продвинутый: tagBase.advanced,
    Эксперт: tagBase.expert,
  }

  return classes[difficulty] ?? tagBase.default
}

function moduleAccent(index: number): { dot: string; chip: string; active: string } {
  const accents = [
    {
      dot: 'bg-accent',
      chip: 'border-accent/35 text-accent hover:bg-accent/10',
      active: 'bg-accent/15',
    },
    {
      dot: 'bg-violet',
      chip: 'border-violet/35 text-violet hover:bg-violet/10',
      active: 'bg-violet/15',
    },
    {
      dot: 'bg-amber',
      chip: 'border-amber/35 text-amber hover:bg-amber/10',
      active: 'bg-amber/15',
    },
    {
      dot: 'bg-rose',
      chip: 'border-rose/35 text-rose hover:bg-rose/10',
      active: 'bg-rose/15',
    },
  ]

  return accents[index % accents.length]
}

function lessonIdFromHash(): string | undefined {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#lesson/')) {
    return undefined
  }

  const slug = decodeURIComponent(window.location.hash.replace('#lesson/', ''))
  return courseLessons.find((lesson) => lesson.slug === slug)?.id
}

function replaceLessonHash(lesson: CourseLesson) {
  window.history.replaceState(null, '', `${window.location.pathname}#lesson/${encodeURIComponent(lesson.slug)}`)
}

function syncLessonFromHash() {
  const lessonId = lessonIdFromHash()

  if (lessonId) {
    selectedLessonId.value = lessonId
  }
}

function queueActiveHeadingUpdate() {
  if (activeHeadingFrame) {
    return
  }

  activeHeadingFrame = requestAnimationFrame(() => {
    activeHeadingFrame = 0
    updateActiveHeading()
  })
}

function updateActiveHeading() {
  const headings = currentLesson.value.headings

  if (headings.length === 0) {
    activeHeadingId.value = ''
    return
  }

  const viewportOffset = 140
  const activeHeading = headings
    .map((heading) => document.getElementById(heading.id))
    .filter((element): element is HTMLElement => Boolean(element))
    .filter((element) => element.getBoundingClientRect().top <= viewportOffset)
    .at(-1)

  activeHeadingId.value = activeHeading?.id ?? headings[0].id
}
</script>

<template>
  <div :class="layout.page">
    <CourseTopBar>
      <div class="flex min-w-0 items-center gap-3">
        <img v-if="brandImageSrc" class="h-10 w-10 max-sm:h-8 max-sm:w-8" :src="brandImageSrc" alt="" />
        <div v-else-if="brandIcon"
          :class="brandIconClass ?? 'grid h-10 w-10 place-items-center rounded-card border border-accent/35 bg-accent/15 text-accent shadow-glow max-sm:h-8 max-sm:w-8'">
          <component :is="brandIcon" :size="22" />
        </div>
        <div class="min-w-0">
          <p class="m-0 text-[11px] font-black uppercase tracking-wide text-muted max-sm:hidden">{{ eyebrow }}</p>
          <h1 class="m-0 truncate text-2xl font-black leading-none max-sm:text-xl">{{ title }}</h1>
        </div>
      </div>

      <div class="grid min-w-0 gap-2 text-sm font-extrabold text-muted max-lg:hidden" aria-label="Общий прогресс курса">
        <span>{{ completedCount }} / {{ courseStats.lessonCount }} уроков</span>
        <ProgressBar :value="completionPercent" :show-value="false" :pt="progressPt" />
      </div>

      <div class="flex items-center gap-2">
        <RouterLink to="/" :class="[buttons.secondary, 'hidden xl:inline-flex']">
          <Home :size="18" />
          <span>Главная</span>
        </RouterLink>
        <RouterLink :to="switchLink.to" :class="[buttons.secondary, 'hidden sm:inline-flex']">
          <span>{{ switchLink.label }}</span>
        </RouterLink>
        <Button :class="[buttons.icon, 'lg:hidden']" title="Открыть темы" aria-label="Открыть темы"
          @click="mobileNavOpen = true">
          <Menu :size="20" />
        </Button>
        <Button :class="[buttons.primary, 'max-sm:hidden']" title="Продолжить курс"
          @click="selectLesson(nextIncompleteLesson)">
          <Play :size="18" />
          <span>Продолжить</span>
        </Button>
      </div>
    </CourseTopBar>

    <div :class="layout.contentGrid">
      <aside :class="layout.stickyPane" aria-label="Навигация по курсу">
        <div :class="[layout.panel, 'flex max-h-[inherit] flex-col overflow-hidden']">
          <div class="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Программа</p>
              <strong class="mt-1 block text-2xl font-black">{{ courseStats.moduleCount }} тем</strong>
            </div>
            <Button :class="buttons.icon" title="Сбросить фильтры" aria-label="Сбросить фильтры"
              :disabled="!hasActiveFilters" @click="clearFilters">
              <Filter :size="18" />
            </Button>
          </div>

          <div class="grid gap-3 border-b border-line px-5 py-4">
            <SearchField v-model="query" placeholder="Поиск по урокам" />

            <AppSelect v-model="categoryFilter" data-testid="category-filter" :options="categoryOptions" />

            <AppSelect v-model="difficultyFilter" data-testid="difficulty-filter" :options="difficultyOptions" />

            <div class="grid grid-cols-[minmax(0,1fr)_42px] gap-2">
              <AppSelect v-model="completionFilter" data-testid="completion-filter" :options="completionOptions" />
              <Button :class="favoritesOnly ? buttons.favoriteActive : buttons.favorite" :aria-pressed="favoritesOnly"
                title="Показать избранные" @click="favoritesOnly = !favoritesOnly">
                <Heart :size="17" />
              </Button>
            </div>
          </div>

          <div class="px-5 py-3 text-xs font-extrabold text-muted">{{ visibleLessonCount }} уроков найдено</div>

          <nav class="grid gap-5 overflow-auto px-3 pb-5">
            <div v-if="visibleModules.length === 0"
              class="grid justify-items-center gap-3 px-3 py-8 text-center text-muted">
              <Search :size="22" />
              <p class="m-0 font-black">Ничего не найдено</p>
              <Button :class="buttons.subtle" @click="clearFilters">Сбросить</Button>
            </div>

            <section v-for="(module, moduleIndex) in visibleModules" :key="module.id" class="grid gap-2">
              <button
                class="grid w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 bg-transparent px-2 text-left"
                type="button" @click="selectCategory(module.title)">
                <span :class="['h-2.5 w-2.5 rounded-full', moduleAccent(moduleIndex).dot]"></span>
                <span class="truncate text-sm font-black text-ink">{{ module.title }}</span>
                <small class="text-xs font-black text-muted">{{ moduleCompletion(module).completed }}/{{
                  module.lessons.length }}</small>
              </button>

              <ProgressBar :value="moduleCompletion(module).percent" :show-value="false" :pt="progressPt" />

              <div class="grid gap-1">
                <button v-for="lesson in module.lessons" :key="lesson.id" :class="[
                  'grid min-h-10 w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-card border p-2 text-left transition',
                  lesson.id === currentLesson.id
                    ? 'border-accent/40 bg-accent/10 text-ink'
                    : 'border-transparent text-ink/78 hover:border-line hover:bg-panel-soft',
                ]" type="button" @click="selectLesson(lesson)">
                  <CheckCircle2 v-if="progress.isCompleted(lesson.id)" class="text-accent" :size="18" />
                  <Circle v-else class="text-muted-soft" :size="18" />
                  <span class="min-w-0 truncate text-sm">
                    <strong class="mr-1 text-xs text-muted">{{ formatOrder(lesson.order) }}</strong>
                    {{ lesson.title }}
                  </span>
                  <small class="text-[11px] font-black text-muted">{{ lesson.readingMinutes }} мин</small>
                </button>
              </div>
            </section>
          </nav>
        </div>
      </aside>

      <main class="grid min-w-0 gap-4">
        <article id="lesson-top" :class="[layout.panel, 'min-w-0 overflow-hidden']">
          <div
            class="flex items-center justify-between gap-4 border-b border-line px-5 py-4 max-sm:flex-col max-sm:items-start">
            <div class="flex min-w-0 items-center gap-2 text-sm font-black text-muted">
              <LayoutList :size="17" />
              <span class="truncate">{{ currentModule.title }}</span>
              <span>/</span>
              <strong class="text-ink">{{ currentLesson.title }}</strong>
            </div>

            <div class="flex items-center gap-2 max-sm:w-full">
              <Button :class="currentLessonFavorite ? buttons.iconActive : buttons.icon"
                :aria-pressed="currentLessonFavorite" title="Добавить в избранное" aria-label="Добавить в избранное"
                @click="progress.toggleFavorite(currentLesson.id)">
                <Heart :size="19" />
              </Button>
              <Button :class="[currentLessonCompleted ? buttons.completeDone : buttons.complete, 'max-sm:flex-1']"
                :aria-pressed="currentLessonCompleted" title="Отметить урок"
                @click="progress.toggleCompleted(currentLesson.id)">
                <CheckCircle2 :size="18" />
                <span>{{ currentLessonCompleted ? 'Пройден' : 'Отметить' }}</span>
              </Button>
            </div>
          </div>

          <header class="border-b border-line bg-linear-to-b from-panel-raised to-panel px-6 py-9 sm:px-10 lg:px-14">
            <div class="mb-5 flex flex-wrap items-center gap-2">
              <Tag :value="currentLesson.difficulty" :class="difficultyClass(currentLesson.difficulty)" />
              <span
                class="inline-flex min-h-7 items-center rounded-full border border-line px-3 text-xs font-black text-muted">
                {{ currentLesson.readingMinutes }} мин чтения
              </span>
              <span
                class="inline-flex min-h-7 items-center rounded-full border border-line px-3 text-xs font-black text-muted">
                {{ currentLesson.codeBlocks }} блоков кода
              </span>
            </div>

            <h2 class="m-0 max-w-5xl text-[clamp(2.1rem,4vw,4rem)] font-black leading-[1.03] tracking-normal text-ink">
              {{ currentLesson.title }}
            </h2>
            <p class="mt-5 max-w-3xl text-lg leading-8 text-muted">{{ currentLesson.description }}</p>
          </header>

          <div :class="markdown.container" v-html="currentLesson.html"></div>

          <footer class="flex items-center justify-between gap-3 border-t border-line p-5 max-sm:flex-col">
            <Button :class="[buttons.secondary, 'max-sm:w-full']" :disabled="!previousLesson" title="Предыдущий урок"
              @click="previousLesson && selectLesson(previousLesson)">
              <ArrowLeft :size="18" />
              <span>Назад</span>
            </Button>
            <Button :class="[buttons.primary, 'max-sm:w-full']" :disabled="!nextLesson" title="Следующий урок"
              @click="nextLesson && selectLesson(nextLesson)">
              <span>Дальше</span>
              <ArrowRight :size="18" />
            </Button>
          </footer>
        </article>
      </main>

      <aside :class="[layout.stickyPane, 'max-xl:hidden']" aria-label="Оглавление урока">
        <div :class="[layout.panel, 'grid max-h-[inherit] gap-5 overflow-hidden p-4']">
          <div class="grid gap-3 overflow-hidden">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Оглавление</p>
            <nav class="grid max-h-[42vh] gap-1 overflow-auto">
              <a v-for="heading in currentLesson.headings" :key="heading.id" :class="[
                'rounded-md border px-3 py-2 text-sm font-bold leading-snug no-underline transition',
                heading.id === activeHeadingId
                  ? 'border-accent/40 bg-accent/15 text-accent shadow-glow'
                  : 'border-transparent text-ink/75 hover:bg-accent/10 hover:text-accent',
              ]" :href="`#${heading.id}`">
                {{ heading.title }}
              </a>
            </nav>
          </div>

          <div class="grid gap-3">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Маршрут</p>
            <div class="grid gap-2 rounded-card border border-line bg-panel-soft p-3">
              <span class="text-xs font-black uppercase tracking-wide text-muted">Сейчас</span>
              <strong class="text-lg font-black">{{ currentLessonIndex + 1 }} из {{ courseStats.lessonCount }}</strong>
              <ProgressBar :value="((currentLessonIndex + 1) / courseStats.lessonCount) * 100" :show-value="false"
                :pt="progressPt" />
            </div>
          </div>

          <div v-if="upcomingLessons.length > 0" class="grid gap-3">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Дальше в теме</p>
            <button v-for="lesson in upcomingLessons" :key="lesson.id"
              class="grid min-h-11 grid-cols-[34px_minmax(0,1fr)] items-center gap-2 rounded-card border border-line bg-panel-soft p-2 text-left transition hover:border-accent/40 hover:bg-accent/10"
              type="button" @click="selectLesson(lesson)">
              <span class="text-xs font-black text-muted">{{ formatOrder(lesson.order) }}</span>
              <strong class="truncate text-sm font-black text-ink">{{ lesson.title }}</strong>
            </button>
          </div>
        </div>
      </aside>
    </div>

    <Drawer v-model:visible="mobileNavOpen" header="Темы курса" position="left" :pt="drawerPt">
      <div class="grid gap-4">
        <SearchField v-model="query" placeholder="Поиск по урокам" />

        <section v-for="(module, moduleIndex) in visibleModules" :key="module.id" class="grid gap-2">
          <button
            class="grid w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 bg-transparent px-2 text-left"
            type="button" @click="selectCategory(module.title)">
            <span :class="['h-2.5 w-2.5 rounded-full', moduleAccent(moduleIndex).dot]"></span>
            <span class="truncate text-sm font-black text-ink">{{ module.title }}</span>
            <small class="text-xs font-black text-muted">{{ moduleCompletion(module).completed }}/{{
              module.lessons.length }}</small>
          </button>

          <button v-for="lesson in module.lessons" :key="lesson.id" :class="[
            'grid min-h-10 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-card border p-2 text-left transition',
            lesson.id === currentLesson.id ? 'border-accent/40 bg-accent/10' : 'border-transparent hover:border-line hover:bg-panel-soft',
          ]" type="button" @click="selectLesson(lesson)">
            <CheckCircle2 v-if="progress.isCompleted(lesson.id)" class="text-accent" :size="18" />
            <Circle v-else class="text-muted-soft" :size="18" />
            <span class="min-w-0 truncate text-sm text-ink/85">
              <strong class="mr-1 text-xs text-muted">{{ formatOrder(lesson.order) }}</strong>
              {{ lesson.title }}
            </span>
          </button>
        </section>
      </div>
    </Drawer>
  </div>
</template>
