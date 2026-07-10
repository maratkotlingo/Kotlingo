<script setup lang="ts">
import { layout } from '@/shared/config/ui'

withDefaults(
  defineProps<{
    eyebrow?: string
    title?: string
    progressLabel?: string
  }>(),
  {
    eyebrow: '',
    title: '',
    progressLabel: undefined,
  },
)
</script>

<template>
  <header :class="layout.header">
    <slot>
      <div class="flex min-w-0 items-center gap-3">
        <slot name="icon" />
        <div class="min-w-0">
          <p class="m-0 text-[11px] font-black uppercase tracking-wide text-muted max-sm:hidden">{{ eyebrow }}</p>
          <h1 class="m-0 truncate text-2xl font-black leading-none max-sm:text-xl">{{ title }}</h1>
        </div>
      </div>

      <div class="grid min-w-0 gap-2 text-sm font-extrabold text-muted max-lg:hidden">
        <span v-if="progressLabel">{{ progressLabel }}</span>
        <slot name="progress" />
      </div>

      <div class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </slot>
  </header>
</template>
