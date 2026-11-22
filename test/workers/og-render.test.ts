import { describe, expect, it } from 'vitest'
import { renderOgCard } from '../../src/http/og/render.js'

describe('the Workers font engine', () => {
  it('renders distinct full-size cards during concurrent first use without dynamic WASM compilation', async () => {
    // Workerd rejects dynamic WASM compilation. Calling the renderer directly
    // also ensures a static-image fallback cannot mask a failed font loader.
    const results = await Promise.all(['Alice', 'Bob'].map(hostName => renderOgCard({
      hostName,
      brandName: 'Cadence',
      durationMinutes: 30,
      timeLabel: '10:30 UTC',
      avatars: [{ initial: hostName[0]! }],
    })))
    for (const png of results) {
      expect(png).not.toBeNull()
      expect(png!.length).toBeGreaterThan(10_000)
      expect(Array.from(png!.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      const header = new DataView(png!.buffer, png!.byteOffset, png!.byteLength)
      expect(header.getUint32(16)).toBe(1200)
      expect(header.getUint32(20)).toBe(630)
    }
    expect(results[0]).not.toEqual(results[1])
  })
})
