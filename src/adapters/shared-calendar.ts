import type { CalendarShare, EnginePorts, Repositories, SharedCalendarEvent } from '../ports.js'
import type { Interval } from '../core/domain/types.js'
import { bucketsToIntervals, subtractIntervals } from '../core/slots/intervals.js'
import { partitionConnections } from '../core/domain/booking-service.js'

/** The only detailed reads are the (connection, calendar) pairs in the owner's grant. */
export async function sharedWeek(ports: EnginePorts, repos: Repositories, grant: CalendarShare, range: Interval) {
  const [connections, locks] = await Promise.all([
    repos.connections.listForUser(grant.ownerId), repos.slotLocks.busyBuckets([grant.ownerId], range),
  ])
  const details: SharedCalendarEvent[] = []
  const hidden = bucketsToIntervals(locks.get(grant.ownerId) ?? [])
  let incomplete = false
  const { read } = partitionConnections(connections)
  for (const connection of connections) {
    const selected = grant.calendars.filter(c => c.connectionId === connection.id)
    if (!selected.length && !read.includes(connection)) continue
    if (connection.syncStatus !== 'ok') { incomplete = true; continue }
    const busy = async () => {
      if (read.includes(connection)) hidden.push(...await ports.calendars.get(connection.provider).getBusy(connection, range))
    }
    try { await busy() } catch { incomplete = true }
    for (const { calendarId } of selected) {
      try {
        const provider = ports.calendars.get(connection.provider)
        if (!provider.sharedEvents) throw new Error('Calendar details unavailable')
        for (const event of await provider.sharedEvents(connection, calendarId, range)) {
          if (event.title) details.push(event)
          else hidden.push({ start: event.start, end: event.end })
        }
      } catch { incomplete = true }
    }
  }
  const anonymous = subtractIntervals(hidden, details.filter(e => !e.free)).map(x => ({ ...x, title: null }))
  return { events: [...details, ...anonymous].sort((a,b) => a.start - b.start || a.end - b.end), incomplete }
}
