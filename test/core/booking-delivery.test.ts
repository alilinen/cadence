import { describe, expect, it } from 'vitest'
import { createBrevoSender } from '../../src/adapters/email/index.js'

describe('provider delivery evidence', () => {
  it('checks only the original provider receipt and distinguishes acceptance, delivery and a bounce', async () => {
    let event = 'deferred'
    const receipt = '<one@example.test>'
    const sender = createBrevoSender({
      apiKey: 'test',
      fromName: 'Test',
      from: 'one@example.test',
      fetch: async (input) => {
        expect(new URL(String(input)).searchParams.get('messageId')).toBe(receipt)
        return Response.json({
          events: [
            { messageId: 'other', event: 'hardBounces' },
            { messageId: receipt, event },
          ],
        })
      },
    })
    expect(await sender.deliveryState!(receipt)).toBeNull()
    event = 'delivered'
    expect(await sender.deliveryState!(receipt)).toBe('delivered')
    event = 'hardBounces'
    expect(await sender.deliveryState!(receipt)).toBe('bounced')
  })
})
