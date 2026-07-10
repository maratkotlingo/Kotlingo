import { defineStore } from 'pinia'

interface PersistedProgress {
  completedLessonIds: string[]
  favoriteLessonIds: string[]
}

const storageKey = 'kotlingo:course-progress'

export const useCourseProgressStore = defineStore('courseProgress', {
  state: () => loadProgress(),
  getters: {
    completedSet: (state) => new Set(state.completedLessonIds),
    favoriteSet: (state) => new Set(state.favoriteLessonIds),
  },
  actions: {
    isCompleted(lessonId: string): boolean {
      return this.completedSet.has(lessonId)
    },
    isFavorite(lessonId: string): boolean {
      return this.favoriteSet.has(lessonId)
    },
    toggleCompleted(lessonId: string) {
      this.completedLessonIds = toggleId(this.completedLessonIds, lessonId)
      saveProgress(this.$state)
    },
    toggleFavorite(lessonId: string) {
      this.favoriteLessonIds = toggleId(this.favoriteLessonIds, lessonId)
      saveProgress(this.$state)
    },
    reset() {
      this.completedLessonIds = []
      this.favoriteLessonIds = []
      saveProgress(this.$state)
    },
  },
})

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
}

function loadProgress(): PersistedProgress {
  if (typeof window === 'undefined') {
    return { completedLessonIds: [], favoriteLessonIds: [] }
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? (JSON.parse(raw) as Partial<PersistedProgress>) : {}

    return {
      completedLessonIds: Array.isArray(parsed.completedLessonIds) ? parsed.completedLessonIds : [],
      favoriteLessonIds: Array.isArray(parsed.favoriteLessonIds) ? parsed.favoriteLessonIds : [],
    }
  } catch {
    return { completedLessonIds: [], favoriteLessonIds: [] }
  }
}

function saveProgress(progress: PersistedProgress) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, JSON.stringify(progress))
}
