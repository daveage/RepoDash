import { randomUUID } from 'node:crypto'
import { runOperation } from './ops'

/** Background fetches share the network with the user's own work; a few at a time is enough. */
const PARALLEL = 3

/** Fetches every repository every few minutes, so cards show new remote commits without a click. */
export class AutoFetch {
  private timer: NodeJS.Timeout | null = null
  private minutes = 0
  private running = false

  constructor(
    private repos: () => string[],
    private onFetched: (path: string) => void
  ) {}

  configure(minutes: number): void {
    if (minutes === this.minutes) return
    this.minutes = minutes
    if (this.timer) clearInterval(this.timer)
    this.timer = minutes > 0 ? setInterval(() => void this.run(), minutes * 60_000) : null
  }

  stop(): void {
    this.configure(0)
  }

  private async run(): Promise<void> {
    // A slow network can make one round outlast the interval; skip rather than pile up.
    if (this.running) return
    this.running = true
    try {
      const queue = [...this.repos()]
      const worker = async () => {
        for (let path = queue.shift(); path; path = queue.shift()) {
          // A repository busy with the user's own operation is skipped (runOperation refuses it).
          const result = await runOperation(path, { kind: 'fetch' }, `auto-${randomUUID()}`, () => {})
          if (result.ok) this.onFetched(path)
        }
      }
      await Promise.all(Array.from({ length: PARALLEL }, worker))
    } finally {
      this.running = false
    }
  }
}
