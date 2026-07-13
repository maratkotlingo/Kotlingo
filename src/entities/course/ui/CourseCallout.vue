<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  type: 'tip' | 'trap'
  title?: string
}>()

const variant = computed(() =>
  props.type === 'trap'
    ? {
        kicker: 'Осторожно',
        title: 'Разбор частой ошибки',
        className: 'border-rose/30 bg-rose/10',
      }
    : {
        kicker: 'Совет',
        title: 'Практический ориентир',
        className: 'border-accent/25 bg-accent/10',
      },
)

const calloutClass = 'my-6 rounded-card border p-5 shadow-glow'
const kickerClass = 'mb-1 text-xs font-black uppercase tracking-wide text-muted'
const titleClass = 'mb-2 text-lg font-black text-ink'
const bodyClass = 'text-ink/88 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'
</script>

<template>
  <aside :class="[calloutClass, variant.className]">
    <div :class="kickerClass">{{ variant.kicker }}</div>
    <p :class="titleClass">{{ title || variant.title }}</p>
    <div :class="bodyClass">
      <slot />
    </div>
  </aside>
</template>
