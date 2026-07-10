<script setup lang="ts">
import CourseCallout from './CourseCallout.vue'

defineProps<{
  title?: string
}>()
</script>

<template>
  <CourseCallout type="trap" :title="title">
    <slot />
  </CourseCallout>
</template>
