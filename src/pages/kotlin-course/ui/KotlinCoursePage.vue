<script setup lang="ts">
import CourseReaderPage from '@/widgets/course-layout/ui/CourseReaderPage.vue'
import {
  courseCategories,
  courseDifficulties,
  courseLessons,
  courseModules,
  courseStats,
} from '@/entities/course/model/course'
</script>

<template>
  <CourseReaderPage
    eyebrow="Kotlin learning track"
    title="Kotlingo"
    brand-image-src="/favicon.svg"
    :lessons="courseLessons"
    :modules="courseModules"
    :categories="courseCategories"
    :difficulties="courseDifficulties"
    :stats="courseStats"
    :switch-link="{ to: '/compose', label: 'Compose' }"
  />
</template>
