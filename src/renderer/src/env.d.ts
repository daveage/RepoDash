import type { RepoDashApi } from '../../shared/types'

declare global {
  interface Window {
    repodash: RepoDashApi
  }
}
