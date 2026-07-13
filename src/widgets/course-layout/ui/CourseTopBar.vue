<script setup lang="ts">
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

const headerClass =
  'sticky top-0 z-40 grid min-h-[72px] grid-cols-[minmax(0,1fr)_minmax(220px,360px)_auto] items-center gap-5 border-b border-line/80 bg-app/90 px-6 py-3 shadow-panel backdrop-blur-xl max-lg:grid-cols-[minmax(0,1fr)_auto] max-sm:min-h-16 max-sm:px-3'
</script>

<template>
  <header :class="headerClass">
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
