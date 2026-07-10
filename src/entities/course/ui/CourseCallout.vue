<script setup lang="ts">
import { computed } from 'vue'
import { markdown } from '@/shared/config/markdown'

const props = defineProps<{
  type: 'tip' | 'trap'
  title?: string
}>()

const variant = computed(() =>
  props.type === 'trap'
    ? {
        kicker: 'Осторожно',
        title: 'Разбор частой ошибки',
        className: markdown.calloutTrap,
      }
    : {
        kicker: 'Совет',
        title: 'Практический ориентир',
        className: markdown.calloutTip,
      },
)
</script>

<template>
  <aside :class="[markdown.callout, variant.className]">
    <div :class="markdown.calloutKicker">{{ variant.kicker }}</div>
    <p :class="markdown.calloutTitle">{{ title || variant.title }}</p>
    <div :class="markdown.calloutBody">
      <slot />
    </div>
  </aside>
</template>
