<script setup lang="ts">
import { RouterLink } from 'vue-router'

const year = new Date().getFullYear()
</script>

<template>
  <footer class="border-t border-line bg-app">
    <div
      class="mx-auto flex min-h-20 w-full max-w-[1780px] items-center justify-between gap-4 px-6 py-5 text-sm text-muted max-sm:flex-col max-sm:items-start max-sm:px-3"
    >
      <RouterLink class="flex items-center gap-2 font-black text-ink no-underline" to="/">
        <img class="h-7 w-7" src="/favicon.svg" alt="" />
        <span>Kotlingo</span>
      </RouterLink>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 font-extrabold">
        <span>© {{ year }}</span>
        <RouterLink class="text-muted no-underline transition hover:text-accent" to="/kotlin">Kotlin</RouterLink>
        <RouterLink class="text-muted no-underline transition hover:text-accent" to="/compose">Compose</RouterLink>
      </div>
    </div>
  </footer>
</template>
