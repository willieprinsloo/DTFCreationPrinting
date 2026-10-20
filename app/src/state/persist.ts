export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
}

export function createMemoryStore(): KeyValueStore {
  const m = new Map<string, unknown>()
  return {
    async get<T>(key: string) {
      return m.has(key) ? (structuredClone(m.get(key)) as T) : undefined
    },
    async set<T>(key: string, value: T) {
      m.set(key, structuredClone(value))
    },
  }
}

/** Tauri-backed store; the plugin is imported lazily so non-Tauri contexts (tests) never load it. */
export function createTauriStore(file = 'settings.json'): KeyValueStore {
  let handle: Promise<import('@tauri-apps/plugin-store').Store> | undefined
  const open = () => {
    handle ??= import('@tauri-apps/plugin-store').then((m) => m.Store.load(file))
    return handle
  }
  return {
    async get<T>(key: string) {
      return (await (await open()).get<T>(key)) ?? undefined
    },
    async set<T>(key: string, value: T) {
      const s = await open()
      await s.set(key, value)
      await s.save()
    },
  }
}
