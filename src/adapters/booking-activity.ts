import { activityIdentity, isCalendarWrite, reminderMinutes, type ActivityOperation, type ActivityRole } from '../core/domain/booking-activity.js'
import { refreshInvitation } from './notify.js'
import { bookingGuests } from '../core/domain/guests.js'
import { DEFAULT_REMINDERS, type ReminderRule } from '../core/domain/reminders.js'
import type { Booking } from '../core/domain/types.js'
import type { ActivityRow, EmailMessage, EnginePorts } from '../ports.js'

export class MailOutcomeUnknown extends Error {}

export async function beginActivity(
  ports: EnginePorts,
  booking: Booking,
  operation: ActivityOperation,
  target: string,
  recipient: string,
  role: ActivityRole,
  detail: string,
  validity?: string,
) {
  const journal = ports.repositories({ consistency: 'bookmark' }).activity
  if (!journal) return
  const revision = booking.revision ?? 0
  const identity = activityIdentity(operation)
  const id = await ports.crypto.hash(JSON.stringify([booking.id, revision, identity, target]))
  const now = ports.clock.now()
  await journal.add({
    id,
    bookingId: booking.id,
    revision,
    operation,
    action: identity,
    target,
    recipient,
    role,
    detail,
    state: 'queued',
    created: now,
    updated: now,
    retried: 0,
    validity,
    payload: null,
    receipt: null,
  })
  return id
}

async function sealedMail(ports: EnginePorts, id: string, message: EmailMessage) {
  return JSON.stringify(await ports.crypto.encrypt(JSON.stringify(message), 'booking-mail:' + id))
}

function isInvitation(operation: ActivityRow['operation']) {
  return operation === 'confirmation' || operation === 'reschedule' || operation === 'participants.updated'
}

function confirmationValidity(ports: EnginePorts, b: Booking) {
  return ports.crypto.hash(JSON.stringify([b.startUtc, b.endUtc, b.guestEmail, b.manageTokenHash]))
}
function reminderValidity(ports: EnginePorts, rule: ReminderRule) {
  return ports.crypto.hash(
    JSON.stringify([rule.minutes, rule.audience, rule.subject ?? '', rule.message ?? '']),
  )
}

export type ClaimedMailDelivery = (
  message: EmailMessage,
  startActivity: () => Promise<string | undefined>,
) => Promise<void>

export async function queueBookingMail(
  ports: EnginePorts,
  booking: Booking,
  operation: ActivityOperation,
  message: EmailMessage,
  role: ActivityRole,
  detail: string,
  deliver?: ClaimedMailDelivery,
  rule?: ReminderRule,
) {
  const startActivity = async () => {
    let validity
    if (ports.repositories({ consistency: 'bookmark' }).activity) {
      if (rule) {
        validity = await reminderValidity(ports, rule)
        message.reminderRuleHash = validity
      } else if (isInvitation(operation)) validity = await confirmationValidity(ports, booking)
    }
    return beginActivity(ports, booking, operation, message.to.toLowerCase(), message.to, role, detail, validity)
  }
  if (deliver) return deliver(message, startActivity)
  const id = await startActivity()
  try {
    await ports.queue.send({ kind: 'email', message, ...(id ? { activityId: id } : {}) })
  } catch (error) {
    if (id)
      await ports
        .repositories({ consistency: 'bookmark' })
        .activity!.change(id, 'queued', 'failed', ports.clock.now(), {
          payload: await sealedMail(ports, id, message),
        })
    console.error('[cadence] booking email failed to queue', error)
  }
}

export async function deliverBookingMail(
  ports: EnginePorts,
  message: EmailMessage,
  id?: string,
  manual = false,
) {
  const journal = id && ports.repositories({ consistency: 'bookmark' }).activity
  if (!journal || !id) {
    await ports.email.send(message)
    return
  }
  const row = await journal.get(id)
  if (!row || (row.state !== 'queued' && row.state !== 'failed')) return
  if ((manual && row.state !== 'failed') || (row.state === 'failed' && row.retried)) return
  if (row.operation === 'unknown') return
  const leadMinutes = reminderMinutes(row.operation)
  if (leadMinutes !== undefined && (message.reminderRuleHash ?? null) !== (row.validity ?? null))
    return
  const repos = ports.repositories({ consistency: 'bookmark' })
  const current = await repos.bookings.byId(row.bookingId)
  let relevant = Boolean(
    current &&
    ((row.operation === 'participant.removed' && current.status === 'cancelled') ||
      current.status === (row.operation === 'cancellation' ? 'cancelled' : 'confirmed')),
  )
  if (current && relevant && (current.revision ?? 0) !== row.revision) {
    relevant = false
    if (row.operation === 'participant.removed') {
      const hosts = await Promise.all(current.hostUserIds.map((id) => repos.users.byId(id)))
      relevant = ![...bookingGuests(current), ...hosts].some((p) => p?.email.toLowerCase() === row.target)
    } else if (row.validity && isInvitation(row.operation)) {
      relevant = row.validity === (await confirmationValidity(ports, current))
      if (relevant) {
        const fresh = await refreshInvitation(ports, current, message, row.role)
        if (fresh) message = fresh
        else relevant = false
      }
    }
  }
  if (current && relevant && leadMinutes !== undefined) {
    const et = await repos.eventTypes.byId(current.eventTypeId)
    const rule = (et?.reminderRules ?? DEFAULT_REMINDERS).find(r => r.minutes === leadMinutes)
    const members =
      row.role === 'Host'
        ? await Promise.all(current.hostUserIds.map((uid) => repos.users.byId(uid)))
        : bookingGuests(current)
    relevant = Boolean(
      et &&
      rule &&
      current.startUtc > ports.clock.now() &&
      members.some((p) => p?.email.toLowerCase() === row.target) &&
      (rule.audience === 'both' || rule.audience === (row.role === 'Host' ? 'hosts' : 'guests')) &&
      row.validity === (await reminderValidity(ports, rule)),
    )
  }
  if (!relevant) {
    await journal.change(id, row.state, 'superseded', ports.clock.now(), {
      payload: null,
      expectedValidity: row.validity ?? null,
    })
    return
  }
  if (
    !(await journal.change(id, row.state, 'running', ports.clock.now(), {
      manual: row.state === 'failed',
      bookingRevision: current?.revision ?? 0,
      expectedValidity: row.validity ?? null,
    }))
  ) {
    if ((await journal.get(id))?.state === row.state)
      throw new Error('Booking changed while claiming delivery')
    return
  }
  let receipt
  try {
    receipt = await ports.email.send(message, id)
  } catch (error) {
    // A transport timeout can occur after acceptance. Never replay that ambiguous envelope.
    const rejected = !(
      error instanceof MailOutcomeUnknown ||
      error instanceof TypeError ||
      (error instanceof Error && error.name === 'AbortError')
    )
    await journal.change(id, 'running', rejected ? 'failed' : 'uncertain', ports.clock.now(), {
      payload: rejected ? await sealedMail(ports, id, message) : null,
    })
    throw error
  }
  try {
    await journal.change(
      id,
      'running',
      ports.config.emailDelivery === 'console' ? 'console' : 'accepted',
      ports.clock.now(),
      { payload: null, receipt: receipt?.id ? ports.config.emailDelivery + ':' + receipt.id : null },
    )
  } catch (error) {
    // Acceptance has already happened. If storage is down, the scheduled sweep closes the claim.
    await journal.change(id, 'running', 'uncertain', ports.clock.now(), { payload: null }).catch(() => {})
    throw error
  }
}

export async function retryMail(ports: EnginePorts, row: ActivityRow) {
  if (!row.payload) return
  const { ciphertext, keyVersion } = JSON.parse(row.payload)
  const mail = JSON.parse(
    await ports.crypto.decrypt(ciphertext, 'booking-mail:' + row.id, keyVersion),
  ) as EmailMessage
  await deliverBookingMail(ports, mail, row.id, true)
}

export function canRecover(row: ActivityRow, booking: Booking, now: number) {
  if (row.operation === 'unknown' || row.state !== 'failed' || row.retried) return false
  if (row.revision !== (booking.revision ?? 0)) {
    if (!row.payload || booking.startUtc <= now) return false
    if (row.operation === 'participant.removed')
      return (
        booking.status !== 'rescheduled' &&
        !bookingGuests(booking).some((g) => g.email.toLowerCase() === row.target)
      )
    return (
      booking.status === 'confirmed' &&
      Boolean(row.validity) &&
      (row.role === 'Host' || bookingGuests(booking).some((g) => g.email.toLowerCase() === row.target)) &&
      isInvitation(row.operation)
    )
  }
  if (row.operation === 'calendar.delete') return booking.status !== 'confirmed'
  if (row.operation === 'cancellation') return booking.status === 'cancelled' && Boolean(row.payload)
  return (
    booking.status === 'confirmed' &&
    booking.startUtc > now &&
    Boolean(row.payload || isCalendarWrite(row.operation))
  )
}
