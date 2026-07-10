export const layout = {
  page:
    'min-h-screen bg-app text-ink [background-image:linear-gradient(var(--grid-line)_1px,transparent_1px),linear-gradient(90deg,var(--grid-line)_1px,transparent_1px)] [background-size:32px_32px]',
  header:
    'sticky top-0 z-40 grid min-h-[var(--header-height)] grid-cols-[minmax(0,1fr)_minmax(220px,360px)_auto] items-center gap-5 border-b border-line/80 bg-app/90 px-6 py-3 shadow-panel backdrop-blur-xl max-lg:grid-cols-[minmax(0,1fr)_auto] max-sm:min-h-16 max-sm:px-3',
  contentGrid:
    'mx-auto grid w-full max-w-[var(--page-max)] grid-cols-[320px_minmax(0,1fr)_300px] items-start gap-5 px-6 py-5 pb-12 max-xl:grid-cols-[300px_minmax(0,1fr)] max-lg:block max-lg:px-3 max-lg:py-4',
  panel: 'rounded-card border border-line bg-panel/95 shadow-panel backdrop-blur-xl',
  stickyPane: 'sticky top-[92px] max-h-[calc(100vh-112px)] max-lg:hidden',
}

export const buttons = {
  icon:
    'inline-flex h-10 w-10 items-center justify-center gap-2 rounded-control border border-line bg-panel-raised text-muted transition hover:border-accent/50 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45',
  iconActive:
    'inline-flex h-10 w-10 items-center justify-center gap-2 rounded-control border border-accent/50 bg-accent/15 text-accent shadow-glow transition',
  primary:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-accent bg-accent px-4 font-extrabold text-app transition hover:border-accent-strong hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45',
  secondary:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-line bg-panel-raised px-4 font-extrabold text-ink transition hover:border-line-strong hover:bg-panel-soft disabled:cursor-not-allowed disabled:opacity-45',
  subtle:
    'inline-flex min-h-9 items-center justify-center gap-2 rounded-control border border-transparent px-3 font-extrabold text-accent transition hover:bg-accent/10',
  complete:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-accent/35 bg-accent/10 px-4 font-extrabold text-accent transition hover:bg-accent/15',
  completeDone:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-accent bg-accent px-4 font-extrabold text-app transition hover:bg-accent-strong',
  favorite:
    'inline-flex h-10 w-[42px] items-center justify-center rounded-control border border-line bg-panel-raised text-muted transition hover:border-rose/40 hover:bg-rose/10 hover:text-rose',
  favoriteActive:
    'inline-flex h-10 w-[42px] items-center justify-center rounded-control border border-rose/40 bg-rose/15 text-rose transition',
}

export const form = {
  search:
    'grid min-h-11 grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-control border border-line bg-app-soft px-3 text-muted focus-within:border-accent/60 focus-within:shadow-glow',
  input: 'min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted-soft',
}

export const progressPt = {
  root: {
    class: 'relative h-2 overflow-hidden rounded-full bg-line',
  },
  value: {
    class: 'h-full rounded-full bg-gradient-to-r from-accent to-violet transition-[width] duration-300',
  },
  label: {
    class: 'sr-only',
  },
}

export const selectPt = {
  root: {
    class:
      'relative flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-between rounded-control border border-line bg-app-soft px-3 text-sm text-ink transition hover:border-line-strong data-[p-focused=true]:border-accent/60 data-[p-focused=true]:shadow-glow',
  },
  label: {
    class: 'min-w-0 truncate pr-3 text-ink',
  },
  dropdown: {
    class: 'ml-auto inline-flex h-6 w-6 items-center justify-center text-muted',
  },
  overlay: {
    class:
      'z-[90] mt-2 overflow-hidden rounded-card border border-line bg-panel-raised text-ink shadow-panel ring-1 ring-white/5',
    'data-kotlingo-select-surface': 'true',
  },
  listContainer: {
    class: 'max-h-72 overflow-auto overscroll-contain p-1',
    'data-kotlingo-select-surface': 'true',
  },
  list: {
    class: 'm-0 list-none p-0',
    'data-kotlingo-select-surface': 'true',
  },
  option: {
    class:
      'cursor-pointer rounded-md px-3 py-2 text-sm text-ink transition hover:bg-accent/10 data-[p-selected=true]:bg-accent/15 data-[p-selected=true]:text-accent',
    'data-kotlingo-select-surface': 'true',
  },
  optionLabel: {
    class: 'truncate',
  },
  emptyMessage: {
    class: 'px-3 py-2 text-sm text-muted',
  },
}

export const drawerPt = {
  root: {
    class: 'h-screen w-[min(92vw,380px)] border-r border-line bg-panel text-ink shadow-panel',
  },
  mask: {
    class: 'z-[90] bg-black/60 backdrop-blur-sm',
  },
  header: {
    class: 'flex min-h-16 items-center justify-between border-b border-line px-4 font-black text-ink',
  },
  title: {
    class: 'font-black text-ink',
  },
  content: {
    class: 'h-[calc(100vh-4rem)] overflow-auto p-3',
  },
  closeButton: {
    class: buttons.icon,
  },
}

export const tagBase = {
  beginner: 'inline-flex min-h-7 items-center rounded-full bg-accent/12 px-3 text-xs font-black text-accent',
  middle: 'inline-flex min-h-7 items-center rounded-full bg-blue/12 px-3 text-xs font-black text-blue',
  advanced: 'inline-flex min-h-7 items-center rounded-full bg-amber/12 px-3 text-xs font-black text-amber',
  expert: 'inline-flex min-h-7 items-center rounded-full bg-violet/12 px-3 text-xs font-black text-violet',
  default: 'inline-flex min-h-7 items-center rounded-full bg-panel-raised px-3 text-xs font-black text-muted',
}
