<script setup lang="ts">
import { BookOpen, Home, Layers3 } from '@lucide/vue'
import { RouterLink } from 'vue-router'

const navLinks = [
  { label: 'Главная', to: '/', icon: Home },
  { label: 'Kotlin', to: '/kotlin', icon: BookOpen },
  { label: 'Compose', to: '/compose', icon: Layers3 },
]

const linkClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border px-3 text-sm font-extrabold no-underline transition max-sm:px-2'
const activeLinkClass = 'border-accent/45 bg-accent/12 text-accent shadow-glow'
const idleLinkClass = 'border-transparent text-muted hover:border-line hover:bg-panel-soft hover:text-ink'
</script>

<template>
  <header class="border-b border-line bg-app">
    <nav class="mx-auto flex min-h-16 w-full max-w-[1780px] items-center justify-between gap-4 px-6 max-sm:px-3">
      <RouterLink class="flex min-w-0 items-center gap-3 no-underline" to="/">
        <img class="h-9 w-9" src="/favicon.svg" alt="" />
        <span class="truncate text-xl font-black text-ink">Kotlingo</span>
      </RouterLink>

      <div class="flex items-center gap-1.5">
        <RouterLink v-for="link in navLinks" :key="link.to" v-slot="{ href, navigate, isActive }" :to="link.to" custom>
          <a :class="[linkClass, isActive ? activeLinkClass : idleLinkClass]" :href="href" @click="navigate">
            <component :is="link.icon" :size="17" />
            <span class="max-sm:hidden">{{ link.label }}</span>
          </a>
        </RouterLink>
      </div>
    </nav>
  </header>
</template>
