<script setup lang="ts">
import { ArrowRight, BookOpen, Code2, Layers3, Sparkles } from '@lucide/vue'
import { RouterLink } from 'vue-router'
import { buttons, layout } from '@/shared/config/ui'

const tracks = [
  {
    title: 'Kotlin',
    href: '/kotlin',
    status: '104 урока готовы',
    description: 'Плотный курс по языку, типам, функциям, классам, коллекциям, coroutines, JVM, Multiplatform и архитектуре.',
    icon: BookOpen,
    accent: 'border-accent/35 bg-accent/10 text-accent',
  },
  {
    title: 'Jetpack Compose',
    href: '/compose',
    status: 'страница подготовлена',
    description: 'Будущий курс по декларативному Android UI: layout, state, side effects, navigation, Material 3 и тестирование.',
    icon: Layers3,
    accent: 'border-violet/35 bg-violet/10 text-violet',
  },
]
</script>

<template>
  <main :class="[layout.page, 'grid place-items-center px-4 py-8']">
    <section class="grid w-full max-w-6xl gap-8">
      <header :class="[layout.panel, 'overflow-hidden']">
        <div class="grid gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-12">
          <div class="min-w-0">
            <div class="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-accent">
              <Sparkles :size="15" />
              Kotlin and Android learning hub
            </div>
            <h1 class="m-0 max-w-4xl text-[clamp(3rem,8vw,7.5rem)] font-black leading-[0.92] tracking-normal">
              Kotlingo
            </h1>
            <p class="mt-6 max-w-2xl text-lg leading-8 text-muted sm:text-xl">
              Темная учебная среда для последовательного изучения Kotlin и Jetpack Compose:
              темы, уроки, прогресс, избранное, красивое чтение MDX и подготовленная архитектура под новые курсы.
            </p>
            <div class="mt-8 flex flex-wrap gap-3">
              <RouterLink :class="buttons.primary" to="/kotlin">
                <span>Открыть Kotlin</span>
                <ArrowRight :size="18" />
              </RouterLink>
              <RouterLink :class="buttons.secondary" to="/compose">
                <span>Jetpack Compose</span>
                <ArrowRight :size="18" />
              </RouterLink>
            </div>
          </div>

          <div class="grid content-between gap-4 rounded-card border border-line bg-app-soft p-5">
            <div class="grid h-16 w-16 place-items-center rounded-card border border-accent/35 bg-accent/10 text-accent shadow-glow">
              <Code2 :size="30" />
            </div>
            <div>
              <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Сейчас доступно</p>
              <strong class="mt-2 block text-5xl font-black">2</strong>
              <p class="m-0 mt-2 text-sm leading-6 text-muted">страницы курса: готовый Kotlin reader и заготовка Compose.</p>
            </div>
          </div>
        </div>
      </header>

      <section class="grid gap-4 md:grid-cols-2">
        <RouterLink
          v-for="track in tracks"
          :key="track.title"
          :to="track.href"
          :class="[layout.panel, 'group grid gap-5 p-6 no-underline transition hover:-translate-y-0.5 hover:border-line-strong hover:bg-panel-soft']"
        >
          <div class="flex items-start justify-between gap-4">
            <div :class="['grid h-12 w-12 place-items-center rounded-card border', track.accent]">
              <component :is="track.icon" :size="24" />
            </div>
            <ArrowRight class="text-muted transition group-hover:translate-x-1 group-hover:text-accent" :size="22" />
          </div>
          <div>
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">{{ track.status }}</p>
            <h2 class="m-0 mt-2 text-3xl font-black text-ink">{{ track.title }}</h2>
            <p class="m-0 mt-3 text-base leading-7 text-muted">{{ track.description }}</p>
          </div>
        </RouterLink>
      </section>
    </section>
  </main>
</template>
