<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  BookOpen,
  Boxes,
  CheckCircle2,
  Code2,
  Compass,
  Home,
  Layers3,
  Menu,
  Palette,
  Smartphone,
  Sparkles,
} from '@lucide/vue'
import Button from 'primevue/button'
import Drawer from 'primevue/drawer'
import ProgressBar from 'primevue/progressbar'
import AppSelect from '@/shared/ui/AppSelect.vue'
import SearchField from '@/shared/ui/SearchField.vue'
import { buttons, drawerPt, layout, progressPt } from '@/shared/config/ui'
import CourseTopBar from '@/widgets/course-layout/ui/CourseTopBar.vue'
import MetricCard from '@/widgets/course-layout/ui/MetricCard.vue'

interface ComposeModule {
  title: string
  description: string
  lessons: string[]
  accent: string
}

const query = ref('')
const moduleFilter = ref('all')
const mobileNavOpen = ref(false)

const modules: ComposeModule[] = [
  {
    title: 'Основы Compose',
    description: 'Composable-функции, превью, Material 3 и mental model декларативного UI.',
    lessons: ['Что такое Compose', 'Composable и recomposition', 'Preview и tooling'],
    accent: 'accent',
  },
  {
    title: 'Layout и адаптивность',
    description: 'Column, Row, Box, modifiers, constraints, density и responsive-поведение.',
    lessons: ['Modifier как контракт', 'LazyColumn и списки', 'Window size classes'],
    accent: 'violet',
  },
  {
    title: 'State и side effects',
    description: 'State hoisting, remember, flows, lifecycle и эффекты без сюрпризов.',
    lessons: ['remember и mutableStateOf', 'LaunchedEffect', 'collectAsStateWithLifecycle'],
    accent: 'amber',
  },
  {
    title: 'Архитектура UI',
    description: 'ViewModel, UI state, navigation, тестирование и границы модулей.',
    lessons: ['UI state model', 'Navigation Compose', 'Тесты компонентов'],
    accent: 'rose',
  },
]

const moduleOptions = computed(() => [
  { label: 'Все темы', value: 'all' },
  ...modules.map((module) => ({ label: module.title, value: module.title })),
])

const visibleModules = computed(() =>
  modules.filter((module) => {
    const matchesFilter = moduleFilter.value === 'all' || module.title === moduleFilter.value
    const normalizedQuery = query.value.trim().toLocaleLowerCase('ru')
    const matchesQuery =
      normalizedQuery.length === 0 ||
      [module.title, module.description, ...module.lessons].join(' ').toLocaleLowerCase('ru').includes(normalizedQuery)

    return matchesFilter && matchesQuery
  }),
)

const plannedLessonCount = computed(() => modules.reduce((total, module) => total + module.lessons.length, 0))

const composeMetrics = computed(() => [
  { icon: Layers3, label: 'Темы', value: modules.length, iconClass: 'text-violet' },
  { icon: BookOpen, label: 'Уроки', value: plannedLessonCount.value, iconClass: 'text-accent' },
  { icon: Palette, label: 'UI', value: 'M3', iconClass: 'text-amber' },
  { icon: Compass, label: 'Статус', value: 'Draft', iconClass: 'text-rose' },
])

function accentClasses(accent: string): { dot: string; chip: string; panel: string } {
  const classes: Record<string, { dot: string; chip: string; panel: string }> = {
    accent: {
      dot: 'bg-accent',
      chip: 'border-accent/35 text-accent bg-accent/10',
      panel: 'border-accent/30 bg-accent/10',
    },
    violet: {
      dot: 'bg-violet',
      chip: 'border-violet/35 text-violet bg-violet/10',
      panel: 'border-violet/30 bg-violet/10',
    },
    amber: {
      dot: 'bg-amber',
      chip: 'border-amber/35 text-amber bg-amber/10',
      panel: 'border-amber/30 bg-amber/10',
    },
    rose: {
      dot: 'bg-rose',
      chip: 'border-rose/35 text-rose bg-rose/10',
      panel: 'border-rose/30 bg-rose/10',
    },
  }

  return classes[accent] ?? classes.accent
}
</script>

<template>
  <div :class="layout.page">
    <CourseTopBar>
      <div class="flex min-w-0 items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-card border border-violet/35 bg-violet/15 text-violet shadow-glow">
          <Smartphone :size="22" />
        </div>
        <div class="min-w-0">
          <p class="m-0 text-[11px] font-black uppercase tracking-wide text-muted max-sm:hidden">Android UI track</p>
          <h1 class="m-0 truncate text-2xl font-black leading-none max-sm:text-xl">Jetpack Compose</h1>
        </div>
      </div>

      <div class="grid min-w-0 gap-2 text-sm font-extrabold text-muted max-lg:hidden" aria-label="Готовность курса">
        <span>0 / {{ plannedLessonCount }} уроков опубликовано</span>
        <ProgressBar :value="0" :show-value="false" :pt="progressPt" />
      </div>

      <div class="flex items-center gap-2">
        <RouterLink to="/" :class="[buttons.secondary, 'hidden xl:inline-flex']">
          <Home :size="18" />
          <span>Главная</span>
        </RouterLink>
        <RouterLink to="/kotlin" :class="[buttons.secondary, 'hidden sm:inline-flex']">Kotlin</RouterLink>
        <Button :class="[buttons.icon, 'lg:hidden']" title="Открыть темы" aria-label="Открыть темы" @click="mobileNavOpen = true">
          <Menu :size="20" />
        </Button>
      </div>
    </CourseTopBar>

    <div :class="layout.contentGrid">
      <aside :class="layout.stickyPane" aria-label="Навигация по будущему курсу">
        <div :class="[layout.panel, 'flex max-h-[inherit] flex-col overflow-hidden']">
          <div class="border-b border-line px-5 py-4">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Программа</p>
            <strong class="mt-1 block text-2xl font-black">{{ modules.length }} темы</strong>
          </div>

          <div class="grid gap-3 border-b border-line px-5 py-4">
            <SearchField v-model="query" placeholder="Поиск по roadmap" />
            <AppSelect
              v-model="moduleFilter"
              data-testid="compose-module-filter"
              :options="moduleOptions"
            />
          </div>

          <nav class="grid gap-4 overflow-auto px-3 py-4">
            <section v-for="module in visibleModules" :key="module.title" class="grid gap-2">
              <div class="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 px-2">
                <span :class="['h-2.5 w-2.5 rounded-full', accentClasses(module.accent).dot]"></span>
                <strong class="truncate text-sm font-black">{{ module.title }}</strong>
                <small class="text-xs font-black text-muted">{{ module.lessons.length }}</small>
              </div>
              <div class="grid gap-1">
                <div
                  v-for="(lesson, index) in module.lessons"
                  :key="lesson"
                  class="grid min-h-10 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-card border border-transparent p-2 text-ink/70"
                >
                  <CheckCircle2 class="text-muted-soft" :size="18" />
                  <span class="truncate text-sm">
                    <strong class="mr-1 text-xs text-muted">{{ String(index + 1).padStart(2, '0') }}</strong>
                    {{ lesson }}
                  </span>
                </div>
              </div>
            </section>
          </nav>
        </div>
      </aside>

      <main class="grid min-w-0 gap-4">
        <section class="grid grid-cols-4 gap-3 max-md:grid-cols-2 max-[460px]:grid-cols-1">
          <MetricCard
            v-for="item in composeMetrics"
            :key="item.label"
            :icon="item.icon"
            :label="item.label"
            :value="item.value"
            :icon-class="item.iconClass"
          />
        </section>

        <section class="flex gap-2 overflow-x-auto pb-1">
          <button
            v-for="module in modules"
            :key="module.title"
            :class="[
              'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-control border px-3 text-sm font-black transition hover:brightness-125',
              accentClasses(module.accent).chip,
            ]"
            type="button"
            @click="moduleFilter = module.title"
          >
            <span>{{ module.title }}</span>
            <small>{{ module.lessons.length }}</small>
          </button>
        </section>

        <article :class="[layout.panel, 'overflow-hidden']">
          <header class="border-b border-line bg-gradient-to-b from-panel-raised to-panel px-6 py-10 sm:px-10 lg:px-14">
            <div class="mb-5 inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs font-black text-violet">
              <Sparkles :size="15" />
              Готовится к наполнению
            </div>
            <h2 class="m-0 max-w-5xl text-[clamp(2.2rem,4vw,4.3rem)] font-black leading-[1.02]">
              Jetpack Compose: будущий курс в той же среде чтения
            </h2>
            <p class="mt-5 max-w-3xl text-lg leading-8 text-muted">
              Страница уже подготовлена под структуру тем, фильтры, тёмную визуальную систему и будущий MDX-контент.
              Когда появятся уроки, их можно подключить тем же способом, что и Kotlin.
            </p>
          </header>

          <div class="grid gap-4 px-6 py-7 sm:px-10 lg:px-14">
            <div class="grid gap-4 md:grid-cols-2">
              <section
                v-for="module in visibleModules"
                :key="module.title"
                :class="['rounded-card border p-5', accentClasses(module.accent).panel]"
              >
                <div class="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Модуль</p>
                    <h3 class="m-0 mt-1 text-xl font-black">{{ module.title }}</h3>
                  </div>
                  <Boxes :size="22" />
                </div>
                <p class="m-0 text-sm leading-6 text-ink/75">{{ module.description }}</p>
                <div class="mt-4 grid gap-2">
                  <div
                    v-for="lesson in module.lessons"
                    :key="lesson"
                    class="rounded-md border border-white/10 bg-app/30 px-3 py-2 text-sm font-bold text-ink/80"
                  >
                    {{ lesson }}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </article>
      </main>

      <aside :class="[layout.stickyPane, 'max-xl:hidden']" aria-label="Roadmap">
        <div :class="[layout.panel, 'grid gap-5 p-4']">
          <div class="grid gap-3">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Roadmap</p>
            <div class="rounded-card border border-line bg-panel-soft p-4">
              <Code2 class="mb-3 text-accent" :size="22" />
              <strong class="block text-lg font-black">MDX еще не подключены</strong>
              <p class="m-0 mt-2 text-sm leading-6 text-muted">
                Страница держит форму курса, пока контент Compose готовится отдельно.
              </p>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <Drawer v-model:visible="mobileNavOpen" header="Темы Compose" position="left" :pt="drawerPt">
      <div class="grid gap-4">
        <SearchField v-model="query" placeholder="Поиск по roadmap" />
        <section v-for="module in visibleModules" :key="module.title" class="grid gap-2">
          <div class="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 px-2">
            <span :class="['h-2.5 w-2.5 rounded-full', accentClasses(module.accent).dot]"></span>
            <strong class="truncate text-sm font-black">{{ module.title }}</strong>
            <small class="text-xs font-black text-muted">{{ module.lessons.length }}</small>
          </div>
          <div
            v-for="lesson in module.lessons"
            :key="lesson"
            class="rounded-card border border-line bg-panel-soft p-3 text-sm font-bold text-ink/75"
          >
            {{ lesson }}
          </div>
        </section>
      </div>
    </Drawer>
  </div>
</template>

