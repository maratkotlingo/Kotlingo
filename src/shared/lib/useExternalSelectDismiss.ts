import { onMounted, onUnmounted, shallowRef } from 'vue'

export interface SelectOverlayControl {
  hide: (isFocus?: boolean) => void
}

const selectSurfaceSelector =
  '[data-kotlingo-select-surface], [data-pc-section="overlay"], [data-pc-section="listcontainer"]'

export function useExternalSelectDismiss() {
  const openSelect = shallowRef<SelectOverlayControl | null>(null)

  function setOpenSelect(select: SelectOverlayControl | null) {
    openSelect.value = select
  }

  function clearOpenSelect(select?: SelectOverlayControl | null) {
    if (!select || openSelect.value === select) {
      openSelect.value = null
    }
  }

  function isSelectSurface(event: Event): boolean {
    const target = event.target

    return target instanceof Element && Boolean(target.closest(selectSurfaceSelector))
  }

  function dismissFromExternalMotion(event: Event) {
    // PrimeVue overlays are appended to body, so page scroll can move the anchor away from the panel.
    if (!openSelect.value || isSelectSurface(event)) {
      return
    }

    openSelect.value.hide(false)
    openSelect.value = null
  }

  onMounted(() => {
    window.addEventListener('scroll', dismissFromExternalMotion, true)
    window.addEventListener('wheel', dismissFromExternalMotion, true)
    window.addEventListener('touchmove', dismissFromExternalMotion, true)
  })

  onUnmounted(() => {
    window.removeEventListener('scroll', dismissFromExternalMotion, true)
    window.removeEventListener('wheel', dismissFromExternalMotion, true)
    window.removeEventListener('touchmove', dismissFromExternalMotion, true)
  })

  return {
    setOpenSelect,
    clearOpenSelect,
  }
}
