import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { createD1Repositories } from '../../src/adapters/d1/repositories.js'
import { applyBookingRevision, editBookingGuests } from '../../src/core/domain/booking-edits.js'
import { reconcileGoogleBooking, reconcileGoogleCalendars } from '../../src/adapters/calendar-reconcile.js'
import { icsSequenceForBooking, icsUidForBooking } from '../../src/core/ics.js'
import { fakeConfig } from '../../src/testing/fakes.js'
import { createWebCrypto } from '../../src/adapters/crypto/webcrypto.js'
import { issueManageToken, verifyManageToken } from '../../src/core/domain/auth-flows.js'
import type { Booking, CalendarConnection, EventType, User } from '../../src/core/domain/types.js'
import type { CalendarEventSnapshot, EnginePorts, QueueMessage } from '../../src/ports.js'

const NOW = Date.UTC(2026, 10, 10)
const START = NOW + 7 * 86_400_000
const END = START + 1_800_000
const repos = () => createD1Repositories(env.DB, { consistency: 'bookmark' })
const queued: QueueMessage[] = []
let remote: CalendarEventSnapshot
let reads = 0
let failRead = false
const testCrypto = createWebCrypto({ keys: {1:btoa('test-key'.padEnd(32,'.'))}, currentVersion:1, signingKey:btoa('test-signing-key'.padEnd(32,'.')) })
let originalToken: string
const conn: CalendarConnection = { id: 'c_edits', userId: 'u_edits', provider: 'google', providerAccountEmail: 'host@example.com',
  encryptedTokens: 'test', keyVersion: 1, calendarIdsRead: ['primary'], calendarIdWrite: 'primary', syncStatus: 'ok', createdAt: NOW }
const ports = {
  repositories: repos, config: fakeConfig(), clock: { now: () => NOW }, crypto: testCrypto,
  queue: { send: async (m: QueueMessage) => { queued.push(m) } },
  calendars: { get: () => ({ getEvent: async () => { reads++; if (failRead) throw new Error('Calendar temporarily unavailable'); return remote } }) },
} as unknown as EnginePorts
let host: User
let eventType: EventType
let booking: Booking
async function reload() { return (await repos().bookings.byId(booking.id))! }
async function lockRows() { return (await env.DB.prepare('SELECT * FROM slot_locks ORDER BY host_user_id,bucket_start').all()).results }
async function guests(guests: unknown, revision?: number, actor = host) {
  return editBookingGuests(ports, repos(), actor, { bookingId: booking.id, revision: revision ?? (await reload()).revision ?? 0, guests })
}
function invitations(to: string) {
  return queued.filter((m): m is Extract<QueueMessage, {kind:'email'}> => m.kind === 'email' && m.message.to === to)
    .map((m) => new TextDecoder().decode(Uint8Array.from(atob(m.message.attachments![0]!.content), (c) => c.charCodeAt(0))))
}

beforeEach(async () => {
  queued.length = 0; reads = 0; failRead = false
  await env.DB.batch(['slot_locks','bookings','calendar_connections','event_types','team_members','teams','users'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
  await env.DB.prepare("INSERT INTO users (id,email,name,tz,slug,role,created_at) VALUES ('u_edits','host@example.com','Host','UTC','edits','member',0)").run()
  await env.DB.prepare(`INSERT INTO event_types (id,owner_user_id,scheduling_type,slug,title,description,duration_minutes,
    buffer_before_minutes,buffer_after_minutes,min_notice_minutes,max_horizon_days,location_type,questions_json,active,created_at)
    VALUES ('et_edits','u_edits','personal','demo','Demo','',30,0,10,0,365,'phone','[]',1,0)`).run()
  host = (await repos().users.byId('u_edits'))!
  eventType = (await repos().eventTypes.byId('et_edits'))!
  booking = { id: 'b_edits', eventTypeId: eventType.id, hostUserId: host.id, hostUserIds: [host.id],
    guestName: 'Booker', guestEmail: 'booker@example.com', guestTimezone: 'UTC', additionalGuests: ['old@example.com'],
    startUtc: START, endUtc: END, localDate: '2026-11-17', status: 'confirmed', answers: {}, externalEventIds: { [conn.id]: 'google_event' },
    conferenceUrl: 'https://meet.google.com/one-link', rescheduleOf: null, rescheduledTo: null, manageTokenHash: 'test-hash', cancelledAt: null, createdAt: NOW }
  const issued = await issueManageToken({crypto:testCrypto},booking,'manage')
  originalToken = issued.token
  booking.manageTokenHash = issued.tokenHash
  await repos().bookings.createWithLocks(booking, Array.from({length:8},(_,i)=>({ hostUserId:host.id, bucketStart:START+i*300_000 })))
  await repos().bookings.setSyncResult(booking.id, booking.externalEventIds, booking.conferenceUrl)
  await repos().connections.create(conn)
  await repos().bookings.markCalendarSynced(booking.id,0)
  remote = { organizer: true, cancelled:false, start:START, end:END, guests: ['booker@example.com','old@example.com','host@example.com'] }
})

describe('dashboard participant edits', () => {
  it('replaces the booker atomically, preserves the meeting and revokes the old management link', async () => {
    const locks=await lockRows()
    const result=await editBookingGuests(ports,repos(),host,{bookingId:booking.id,revision:0,booker:{name:' New Booker ',email:' New@Example.com '}})
    expect(result.ok).toBe(true)
    const updated=await reload()
    expect(updated).toMatchObject({guestName:'New Booker',guestEmail:'new@example.com',additionalGuests:['old@example.com'],
      startUtc:START,endUtc:END,conferenceUrl:booking.conferenceUrl,externalEventIds:booking.externalEventIds,revision:1})
    expect(await lockRows()).toEqual(locks)
    expect(await verifyManageToken({crypto:testCrypto,repos:repos()},originalToken,'manage',NOW)).toEqual({ok:false,reason:'superseded'})
    const messages=queued.filter((m)=>m.kind==='email')
    const replacement=messages.find((m)=>m.message.to==='new@example.com')!.message
    const token=decodeURIComponent(replacement.text!.match(/\?token=([\w.%-]+)/)![1]!)
    expect((await verifyManageToken({crypto:testCrypto,repos:repos()},token,'manage',NOW)).ok).toBe(true)
    for (const m of messages.filter((m)=>m.message.to!=='new@example.com')) expect(m.message.text).not.toContain(token)
    const [invite]=invitations('new@example.com')
    const [cancel]=invitations('booker@example.com')
    expect(invite).toContain('METHOD:REQUEST')
    expect(cancel).toContain('METHOD:CANCEL')
    expect(invite).toContain('SEQUENCE:1')
    expect(cancel).toContain('SEQUENCE:1')
    expect(invite?.match(/UID:.+/)?.[0]).toBe(cancel?.match(/UID:.+/)?.[0])
    expect(invite).not.toContain(token)
    expect(queued.some((m)=>m.kind==='calendar.sync'&&m.action==='update')).toBe(true)
    queued.length=0
    await reconcileGoogleBooking(ports,repos(),updated)
    expect(reads).toBe(0)
    expect((await reload()).guestEmail).toBe('new@example.com')
  })
  it('promotes an existing guest once, and sends newer invitations when the original booker returns', async () => {
    await editBookingGuests(ports,repos(),host,{bookingId:booking.id,revision:0,booker:{name:'Old Guest',email:'old@example.com'}})
    expect((await reload()).additionalGuests).toEqual([])
    expect(invitations('old@example.com')).toHaveLength(1)
    expect(invitations('old@example.com')[0]).toContain('METHOD:REQUEST')
    await editBookingGuests(ports,repos(),host,{bookingId:booking.id,revision:1,booker:{name:'Booker',email:'booker@example.com'}})
    const [cancel,reinvite]=invitations('booker@example.com')
    expect(cancel).toContain('SEQUENCE:1')
    expect(reinvite).toContain('METHOD:REQUEST')
    expect(reinvite).toContain('SEQUENCE:2')
    expect(cancel?.match(/UID:.+/)?.[0]).toBe(reinvite?.match(/UID:.+/)?.[0])
  })
  it('allows a name correction without rotating access, and rejects invalid or stale booker changes', async () => {
    const edit=(name:unknown,email:unknown,revision=0,actor=host)=>editBookingGuests(ports,repos(),actor,{bookingId:booking.id,revision,booker:{name,email}})
    for (const [name,email] of [['','new@example.com'],['x'.repeat(201),'new@example.com'],['New','bad'],['New','host@example.com'],[{},'new@example.com']]) {
      expect((await edit(name,email)).ok).toBe(false)
    }
    expect((await edit('New','new@example.com',0,{...host,id:'stranger'})).ok).toBe(false)
    expect((await edit(booking.guestName,booking.guestEmail)).ok).toBe(true)
    expect(queued).toHaveLength(0)
    expect((await edit('Corrected name',booking.guestEmail)).ok).toBe(true)
    expect((await reload()).manageTokenHash).toBe(booking.manageTokenHash)
    expect((await verifyManageToken({crypto:testCrypto,repos:repos()},originalToken,'manage',NOW)).ok).toBe(true)
    expect(invitations('booker@example.com')[0]).toContain('METHOD:REQUEST')
    expect((await edit('Stale','new@example.com')).ok).toBe(false)
    expect((await reload()).guestName).toBe('Corrected name')
    expect((await reload()).guestEmail).toBe(booking.guestEmail)
    await env.DB.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").bind(booking.id).run()
    expect((await edit('New','new@example.com',1)).ok).toBe(false)
    await env.DB.prepare("UPDATE bookings SET status='confirmed',start_utc=? WHERE id=?").bind(NOW-1,booking.id).run()
    expect((await edit('New','new@example.com',1)).ok).toBe(false)
  })
  it('adds/removes guests without changing the meeting identity, time, locks or management link', async () => {
    const before = await lockRows()
    expect((await guests('new@example.com')).ok).toBe(true)
    const updated = await reload()
    expect(updated).toMatchObject({ revision:1, additionalGuests:['new@example.com'], startUtc:START, endUtc:END,
      conferenceUrl:booking.conferenceUrl, manageTokenHash:booking.manageTokenHash, externalEventIds:booking.externalEventIds })
    expect(await lockRows()).toEqual(before)
    const added = invitations('new@example.com')[0]!
    const removed = invitations('old@example.com')[0]!
    expect(added).toContain('METHOD:REQUEST')
    expect(removed).toContain('METHOD:CANCEL')
    expect(added).toContain('SEQUENCE:1')
    expect(removed).toContain('SEQUENCE:1')
    expect(added.match(/UID:.+/)?.[0]).toBe(removed.match(/UID:.+/)?.[0])
    expect(queued.some((m)=>m.kind==='calendar.sync' && m.action==='update')).toBe(true)
    expect(invitations('booker@example.com')).toHaveLength(1)
  })
  it('re-invites a removed guest with a strictly newer sequence and stable UID', async () => {
    await guests('new@example.com')
    await guests('old@example.com')
    const [cancel,invite] = invitations('old@example.com')
    expect(cancel).toContain('SEQUENCE:1')
    expect(invite).toContain('SEQUENCE:2')
    expect(invite).toContain('METHOD:REQUEST')
    expect(cancel?.match(/UID:.+/)?.[0]).toBe(invite?.match(/UID:.+/)?.[0])
  })
  it('refuses strangers, invalid addresses, too many guests, host duplicates and stale saves', async () => {
    expect((await guests('new@example.com',0,{...host,id:'stranger'})).ok).toBe(false)
    for (const value of ['invalid','host@example.com',Array.from({length:11},(_,i)=>`g${i}@example.com`)]) expect((await guests(value)).ok).toBe(false)
    await guests('new@example.com',0)
    expect((await guests('stale@example.com',0)).ok).toBe(false)
    expect((await reload()).additionalGuests).toEqual(['new@example.com'])
  })
  it('does not send duplicate notifications for a no-op, and refuses cancelled/past meetings', async () => {
    expect((await guests('old@example.com')).ok).toBe(true)
    expect(queued).toHaveLength(0)
    await env.DB.prepare('UPDATE bookings SET start_utc=? WHERE id=?').bind(NOW-1,booking.id).run()
    expect((await guests('new@example.com')).ok).toBe(false)
    await env.DB.prepare("UPDATE bookings SET start_utc=?,status='cancelled' WHERE id=?").bind(START,booking.id).run()
    expect((await guests('new@example.com')).ok).toBe(false)
  })
})

describe('Google edits imported into the booking', () => {
  it('preserves an explicitly invited guest even when their address is another connected host account', async () => {
    await repos().connections.create({...conn,id:'c_alias',providerAccountEmail:'old@example.com'})
    await repos().connections.create({...conn,id:'c_other_alias',providerAccountEmail:'alias@example.com'})
    remote={...remote,start:START+3_600_000,end:END+3_600_000,guests:[...remote.guests!,'alias@example.com']}
    await reconcileGoogleBooking(ports,repos(),await reload())
    expect((await reload()).additionalGuests).toEqual(['old@example.com'])
    expect((await reload()).startUtc).toBe(remote.start)
  })
  it('imports time, duration and external guests; moves locks and preserves Meet and management links', async () => {
    remote = {...remote,start:START+3_600_000,end:END+4_200_000,guests:['booker@example.com','new@example.com','host@example.com']}
    await reconcileGoogleBooking(ports,repos(),await reload())
    const updated = await reload()
    expect(updated).toMatchObject({startUtc:remote.start,endUtc:remote.end,additionalGuests:['new@example.com'],revision:1,
      conferenceUrl:booking.conferenceUrl,manageTokenHash:booking.manageTokenHash})
    const rows = await lockRows()
    expect(rows).toHaveLength(10)
    expect(rows.every((r)=>Number(r['bucket_start']) >= remote.start!)).toBe(true)
    expect(queued.filter((m)=>m.kind==='email')).toHaveLength(0)
    await repos().bookings.markCalendarSynced(booking.id,1)
    queued.length=0
    await reconcileGoogleBooking(ports,repos(),await reload())
    expect((await reload()).revision).toBe(1)
    expect(queued.filter((m)=>m.kind==='calendar.sync')).toHaveLength(0)
  })
  it('imports repeated time edits, then cancellation, with monotonic invitation sequences', async () => {
    let originalUid = icsUidForBooking(booking,new Map())
    for (let i=1;i<=2;i++) {
      remote={...remote,start:START+i*3_600_000,end:END+i*3_600_000}
      await reconcileGoogleBooking(ports,repos(),await reload())
      const current=await reload()
      expect(icsSequenceForBooking(current,new Map())).toBe(i)
      expect(icsUidForBooking(current,new Map())).toBe(originalUid)
      await repos().bookings.markCalendarSynced(booking.id,i)
    }
    remote={cancelled:true,organizer:true}
    await reconcileGoogleBooking(ports,repos(),await reload())
    const cancelled=await reload()
    expect(cancelled.status).toBe('cancelled')
    expect(await lockRows()).toHaveLength(0)
    expect(icsSequenceForBooking(cancelled,new Map(),true)).toBeGreaterThan(2)
    expect(queued.some((m)=>m.kind==='calendar.sync' && m.action==='delete')).toBe(true)
  })
  it('never lets an older Google copy revert a pending dashboard edit', async () => {
    await guests('new@example.com')
    queued.length=0
    await reconcileGoogleBooking(ports,repos(),await reload())
    expect(reads).toBe(0)
    expect((await reload()).additionalGuests).toEqual(['new@example.com'])
    expect(queued).toEqual([{kind:'calendar.sync',bookingId:booking.id,action:'update'}])
  })
  it('rolls back both the new time and locks on a conflict and records a visible error', async () => {
    const before=await lockRows()
    await env.DB.prepare("INSERT INTO slot_locks (host_user_id,bucket_start,booking_id) VALUES (?,?,?)").bind(host.id,START+3_600_000,'other').run()
    remote={...remote,start:START+3_600_000,end:END+3_600_000}
    await reconcileGoogleCalendars(ports,NOW)
    expect((await reload()).startUtc).toBe(START)
    expect((await reload()).calendarSyncError).toContain('conflicts')
    expect((await lockRows()).filter((r)=>r['booking_id']===booking.id)).toEqual(before)
  })
  it('does not interpret read failures, attendee copies or a missing booker as a cancellation', async () => {
    failRead=true
    await reconcileGoogleCalendars(ports,NOW)
    expect((await reload()).status).toBe('confirmed')
    expect((await reload()).calendarSyncError).toContain('temporarily unavailable')
    failRead=false;remote={cancelled:true,organizer:false}
    await reconcileGoogleCalendars(ports,NOW+1)
    expect((await reload()).status).toBe('confirmed')
    remote={...remote,cancelled:false,start:START,end:END,organizer:true,guests:[]}
    await reconcileGoogleCalendars(ports,NOW+2)
    expect((await reload()).calendarSyncError).toContain('original booker')
  })
  it('a stale concurrent revision cannot release or replace the winning edit\'s locks', async () => {
    const original=await reload()
    const patch={startUtc:START+3_600_000,endUtc:END+3_600_000,additionalGuests:[],status:'confirmed' as const}
    expect(await applyBookingRevision(ports,repos(),original,eventType,patch)).not.toBeNull()
    const locks=await lockRows()
    expect(await applyBookingRevision(ports,repos(),original,eventType,{...patch,startUtc:START+7_200_000,endUtc:END+7_200_000})).toBeNull()
    expect(await lockRows()).toEqual(locks)
    expect((await reload()).startUtc).toBe(patch.startUtc)
  })
})

describe('scheduled, configurable reminders', () => {
  it('uses current recipients and rule copy, claims each delivery, retries only the failed recipient', async () => {
    const { handleOne } = await import('../../src/adapters/queue/consumer.js')
    const { sendReminders } = await import('../../src/adapters/scheduled.js')
    const { DEFAULT_REMINDERS } = await import('../../src/core/domain/reminders.js')
    const rules = [{minutes:30,audience:'guests' as const,subject:'Hello {guest}',message:'{event} with {host} on {date} at {time}\n{meeting_link}'}]
    expect(await repos().eventTypes.saveReminders(eventType.id,DEFAULT_REMINDERS,rules)).toBe(true)
    expect(await repos().eventTypes.saveReminders(eventType.id,DEFAULT_REMINDERS,[])).toBe(false)
    let now = START - 31*60_000
    const sent: import('../../src/ports.js').EmailMessage[] = []
    let fail = true
    const runtime = {...ports,clock:{now:()=>now},email:{send:async (mail: import('../../src/ports.js').EmailMessage)=>{
      if (mail.to === 'old@example.com' && fail) { fail = false; throw new Error('temporary') }
      sent.push(mail)
    }}}
    await sendReminders(runtime,now)
    expect(queued).toHaveLength(0)
    now += 2*60_000
    await sendReminders(runtime,now)
    expect(queued).toEqual([{kind:'reminder',bookingId:booking.id,start:START,minutes:30}])
    const job = queued[0]!
    await expect(handleOne(job,runtime)).rejects.toThrow('temporary')
    await Promise.all([handleOne(job,runtime),handleOne(job,runtime)])
    expect(sent.map(m=>m.to).sort()).toEqual(['booker@example.com','old@example.com'])
    expect(sent[0]?.subject).toBe('Hello Booker')
    expect(sent[0]?.text).toContain('Demo with Host')
    expect(sent[0]?.text).toContain(booking.conferenceUrl)
    expect(sent[0]?.attachments).toBeUndefined()

    const newStart = START + 3_600_000
    await env.DB.prepare('UPDATE bookings SET start_utc=?,end_utc=?,guest_email=?,revision=revision+1 WHERE id=?')
      .bind(newStart, newStart+1_800_000,'next@example.com',booking.id).run()
    await handleOne(job,runtime)
    expect(sent).toHaveLength(2)
    now = newStart - 30*60_000
    await sendReminders(runtime,now)
    expect(queued.at(-1)).toMatchObject({kind:'reminder',start:newStart})
    await handleOne(queued.at(-1)!,runtime)
    expect(sent.slice(2).map(m=>m.to).sort()).toEqual(['next@example.com','old@example.com'])
    await repos().eventTypes.saveReminders(eventType.id,rules,[{minutes:30,audience:'hosts'}])
    await handleOne(queued.at(-1)!,runtime)
    expect(sent.at(-1)?.to).toBe(host.email)
    await repos().bookings.cancelWithLockRelease(booking.id,now)
    expect(await repos().bookings.dueReminders(now)).toEqual([])
    await env.DB.prepare('DELETE FROM reminder_deliveries').run()
    await handleOne(queued.at(-1)!,runtime)
    expect(sent).toHaveLength(5)
  })
  it('recovers an abandoned reminder claim and ignores retries after delivery or a rule change', async () => {
    const db = repos().bookings
    const rule = { minutes: 60, audience: 'both' as const }
    const at = START - 60 * 60_000
    expect(await db.claimReminder(booking, rule, 'recipient', at)).toBe(true)
    expect(await db.claimReminder(booking, rule, 'recipient', at + 1)).toBe(false)
    const retry = at + 300_000
    expect(await db.claimReminder(booking, rule, 'recipient', retry)).toBe(true)
    await db.finishReminder(booking, rule.minutes, 'recipient', at, null)
    await db.finishReminder(booking, rule.minutes, 'recipient', retry, retry + 1)
    expect(await db.claimReminder(booking, rule, 'recipient', retry + 300_000)).toBe(false)
    await repos().eventTypes.update(eventType.id, { reminderRules: [{ ...rule, audience: 'hosts' }] })
    expect(await db.claimReminder(booking, rule, 'new-recipient', retry)).toBe(false)
  })

  it('uses the original two rules for existing events and skips disabled reminders already queued', async () => {
    const { handleOne } = await import('../../src/adapters/queue/consumer.js')
    for (const minutes of [60,1440]) expect(await repos().bookings.dueReminders(START-minutes*60_000)).toContainEqual({bookingId:booking.id,start:START,minutes})
    await repos().eventTypes.update(eventType.id,{reminderRules:[]})
    expect(await repos().bookings.dueReminders(START-3_600_000)).toEqual([])
    await handleOne({kind:'reminder',bookingId:booking.id,start:START,minutes:60},ports)
    expect(queued).toHaveLength(0)
  })
})

describe('per-recipient booking activity', () => {
  it('uses the operation for recovery even when the stored label names a different action', async () => {
    const { beginActivity, canRecover } = await import('../../src/adapters/booking-activity.js')
    const store = repos().activity!
    const id = (await beginActivity(ports,booking,'calendar.delete',conn.id,host.email,'Organizer','google'))!
    await store.change(id,'queued','failed',NOW)
    await env.DB.prepare("UPDATE booking_activity SET action='Confirmation' WHERE id=?").bind(id).run()
    const row = (await store.get(id))!
    expect(row).toMatchObject({action:'Confirmation',operation:'calendar.delete'})
    expect(canRecover(row,booking,NOW)).toBe(false)
    expect(canRecover(row,{...booking,status:'cancelled'},NOW)).toBe(true)
    expect(await store.change(id,'failed','running',NOW,{manual:true})).toBe(false)
    await repos().bookings.cancelWithLockRelease(booking.id,NOW)
    expect(await store.change(id,'failed','running',NOW,{manual:true})).toBe(true)
  })

  it.each([
    ['Confirmation','confirmation'],['Calendar delete','calendar.delete'],
    ['Reminder (45 min)','reminder.45m'],['Reminder (1h)','reminder.1h'],
    ['Reminder (24h)','reminder.24h'],
  ] as const)('adopts the original %s id during a rolling upgrade without replay', async (legacy,operation) => {
    const { beginActivity } = await import('../../src/adapters/booking-activity.js')
    const target = 'original-target'
    const id = await ports.crypto.hash(JSON.stringify([booking.id,booking.revision ?? 0,legacy,target]))
    await env.DB.prepare(`INSERT INTO booking_activity(id,bookingId,revision,action,target,recipient,role,detail,state,created,updated,receipt)
      VALUES (?,?,0,?,?,?,'Host','','accepted',0,0,'original-receipt')`).bind(id,booking.id,legacy,target,host.email).run()
    expect(await beginActivity(ports,booking,operation,target,host.email,'Host','')).toBe(id)
    expect(await repos().activity!.list(booking.id)).toEqual([
      expect.objectContaining({id,operation,state:'accepted',receipt:'original-receipt'})
    ])
  })

  it('recovers one rejected email once, retains its history and never exposes its management link in the journal', async () => {
    const {queueBookingMail, deliverBookingMail, retryMail} = await import('../../src/adapters/booking-activity.js')
    const mail = {to:'booker@example.com', subject:'Confirmation',text:'secret-management-link',html:'secret-management-link'}
    let fail = true
    let sends = 0
    const runtime = {...ports, email:{async send() {
      if (fail) throw new Error('Sender rejected')
      sends++
      return {id:'receipt'}
    }}}
    await queueBookingMail(runtime,booking,'confirmation',mail,'Booker','Calendar invitation attached')
    const job = queued[0]!
    if (job.kind !== 'email' || !job.activityId) throw new Error('missing recipient activity')
    await expect(deliverBookingMail(runtime,job.message,job.activityId)).rejects.toThrow('Sender rejected')
    const failed = (await repos().activity!.get(job.activityId))!
    expect(failed.state).toBe('failed')
    expect(failed.payload).toBeTruthy()
    expect(JSON.stringify(failed)).not.toContain('secret-management-link')
    fail = false
    await Promise.all([retryMail(runtime,failed),retryMail(runtime,failed)])
    await deliverBookingMail(runtime,job.message,job.activityId)
    expect(sends).toBe(1)
    const final = (await repos().activity!.get(job.activityId))!
    expect(final).toMatchObject({state:'accepted',receipt:'brevo:receipt',payload:null,retried:1})
    expect(JSON.parse(final.transitions!).map((e:{state:string})=>e.state)).toEqual(['running','failed','running','accepted'])
  })

  it('keeps an ambiguous transport failure separate from a rejection and blocks replay',async()=>{
    const {queueBookingMail,deliverBookingMail,canRecover} = await import('../../src/adapters/booking-activity.js')
    const mail = {to:host.email,subject:'Confirmation',html:'',text:'Hello'}
    let calls = 0
    const runtime = {...ports,email:{async send(){ calls++; throw new TypeError('Network connection reset') }}}
    await queueBookingMail(runtime,booking,'confirmation',mail,'Host','Organizer has a synced event')
    const job = queued[0]!
    if (job.kind !== 'email' || !job.activityId) throw new Error('missing activity')
    await expect(deliverBookingMail(runtime,mail,job.activityId)).rejects.toThrow()
    await deliverBookingMail(runtime,mail,job.activityId)
    const row = (await repos().activity!.get(job.activityId))!
    expect(row.state).toBe('uncertain')
    expect(canRecover(row,booking,NOW)).toBe(false)
    expect(calls).toBe(1)
  })

  it('retries a calendar update on its recorded connection and preserves the other provider and join link',async()=>{
    const {syncCalendar} = await import('../../src/adapters/queue/consumer.js')
    const other: CalendarConnection = {...conn,id:'outlook',provider:'microsoft'}
    await repos().connections.create(other)
    await repos().bookings.setSyncResult(booking.id,{[conn.id]:'google_event',outlook:'ms_event'},booking.conferenceUrl)
    let fail = true
    const calls: string[] = []
    const runtime = {...ports,calendars:{get:()=>({async updateEvent(c: CalendarConnection) {
      calls.push(c.id)
      if (c.id === conn.id && fail) throw new Error('Offline')
    }})}} as unknown as EnginePorts
    const job = {kind:'calendar.sync' as const,action:'update' as const,bookingId:booking.id}
    await syncCalendar(job,runtime)
    const rows = await repos().activity!.list(booking.id)
    const failed = rows.find(r=>r.state==='failed')!
    expect(failed.target).toBe(conn.id)
    expect(rows.find(r=>r.target===other.id)?.state).toBe('done')
    await repos().activity!.change(failed.id,'failed','running',NOW,{manual:true})
    calls.length = 0
    fail = false
    await syncCalendar(job,runtime,failed)
    expect(calls).toEqual([conn.id])
    expect(queued).toEqual([])
    expect((await repos().activity!.get(failed.id))?.state).toBe('done')
    expect(await reload()).toMatchObject({conferenceUrl:booking.conferenceUrl,externalEventIds:{[conn.id]:'google_event',outlook:'ms_event'}})
  })

  it('explains strict and permissive outages using the same slots guests see, hiding private calendar identifiers',async()=>{
    const {loadSlots,calendarPolicyKey} = await import('../../src/engine.js')
    const {dayRange} = await import('../../src/engine.js')
    const range = dayRange('2026-11-17','UTC')
    await repos().availability.create(host.id,{id:'hours',userId:host.id,name:'Private hours',isDefault:true,
      timezone:'UTC',weekly:[[],[],[{startMinute:540,endMinute:720}],[],[],[],[]],overrides:[]})
    const runtime = {...ports,cache:{get:async()=>null,put:async()=>{},delete:async()=>{}},
      calendars:{get:()=>({getBusy:async()=>{throw new Error('Private calendar outage')}})}} as unknown as EnginePorts
    const start = range.start + 10*3_600_000
    const args = {eventType,hostUsers:[host],range}
    for (const strict of [false,true]) {
      await repos().settings.set(calendarPolicyKey(eventType.id),strict?'block':'allow',NOW)
      const hosts: import('../../src/engine.js').HostExplanation[] = []
      const slots = await loadSlots(runtime,args,{start,viewer:'another-user',hosts})
      expect(slots).toEqual(await loadSlots(runtime,args))
      expect(slots.some(s=>s.start===start)).toBe(!strict)
      expect(hosts[0]?.reasons.join(' ')).toContain(strict?'Unavailable until':'unverified')
      expect(hosts[0]?.calendars.join(' ')).toContain('check failed')
      expect(JSON.stringify(hosts)).not.toContain('primary')
      expect(JSON.stringify(hosts)).not.toContain('Private hours')
    }
    const {createCoordinator} = await import('../../src/adapters/coordinator.js')
    const coordinator = createCoordinator({ports:runtime,repositories:repos,hostCalendarNamespace:env.HOST_CALENDAR})
    const attempt = {eventTypeId:eventType.id,hostUserIds:[host.id],start,end:start + 30*60_000,
      guestName:'Test',guestEmail:'test@example.test',guestTimezone:'UTC',answers:{}}
    expect((await coordinator.book(host.id,attempt)).ok).toBe(false)
    await repos().settings.set(calendarPolicyKey(eventType.id),'allow',NOW)
    const allowed = await coordinator.book(host.id,attempt)
    expect(allowed.ok).toBe(true)
    if (allowed.ok) expect(await repos().activity!.list(allowed.booking.id)).toEqual([
      expect.objectContaining({action:'Availability check',recipient:host.email,state:'uncertain'})])
  })
})

describe('booking activity recovery races', () => {
  it('delivers a delayed booker invite with the current people and the original management link', async () => {
    const { notifyBookingCreated } = await import('../../src/adapters/notify.js')
    const { handleOne } = await import('../../src/adapters/queue/consumer.js')
    await notifyBookingCreated({ ports, booking, host, eventType, manageToken: originalToken })
    const pending = queued.find((j) => j.kind === 'email' && j.message.to === booking.guestEmail)!
    expect((await guests('new@example.test')).ok).toBe(true)
    const delivered: import('../../src/ports.js').EmailMessage[] = []
    await handleOne(pending, {
      ...ports,
      email: {
        async send(m) {
          delivered.push(m)
        },
      },
    })
    expect(delivered).toHaveLength(1)
    const [sent] = delivered
    expect(sent!.text).toContain(originalToken)
    expect(sent!.text).toContain('new@example.test')
    expect(sent!.text).not.toContain('old@example.com')
    expect(atob(sent!.attachments![0]!.content)).toContain('SEQUENCE:1')
  })
  it('preserves pending invites across a co-host edit without exposing a booker link or duplicating the synced host event', async () => {
    const { notifyBookingCreated } = await import('../../src/adapters/notify.js')
    const { handleOne } = await import('../../src/adapters/queue/consumer.js')
    await notifyBookingCreated({ ports, booking, eventType, host, manageToken: originalToken })
    await env.DB.prepare(
      "INSERT INTO users (id,email,name,tz,slug,role,created_at) VALUES ('co','co@example.test','Co','UTC','co','member',0)",
    ).run()
    await repos().bookings.replaceHosts(booking.id, [host.id], [host.id, 'co'], host.id, [], [])
    const delivered: import('../../src/ports.js').EmailMessage[] = []
    for (const job of queued.filter((j) => j.kind === 'email'))
      await handleOne(job, {
        ...ports,
        email: {
          async send(m) {
            delivered.push(m)
          },
        },
      })
    expect(delivered.map((m) => m.to).sort()).toEqual(
      [host.email, booking.guestEmail, 'old@example.com'].sort(),
    )
    for (const mail of delivered) {
      expect(mail.text.includes(originalToken)).toBe(mail.to === booking.guestEmail)
      expect(Boolean(mail.attachments?.length)).toBe(mail.to !== host.email)
    }
  })
  it('discards a delayed management link after the booker is replaced', async () => {
    const { notifyBookingCreated } = await import('../../src/adapters/notify.js')
    const { handleOne } = await import('../../src/adapters/queue/consumer.js')
    await notifyBookingCreated({ ports, booking, host, eventType, manageToken: originalToken })
    const pending = queued.find((j) => j.kind === 'email' && j.message.to === booking.guestEmail)!
    expect(
      (
        await editBookingGuests(ports, repos(), host, {
          bookingId: booking.id,
          revision: 0,
          booker: { name: 'New', email: 'new@example.test' },
        })
      ).ok,
    ).toBe(true)
    let count = 0
    await handleOne(pending, {
      ...ports,
      email: {
        async send() {
          count++
        },
      },
    })
    expect(count).toBe(0)
  })
  it('enforces a single retry across a manual attempt and queue redelivery', async () => {
    const { queueBookingMail, retryMail } = await import('../../src/adapters/booking-activity.js')
    const { handleOne } = await import('../../src/adapters/queue/consumer.js')
    let attempts = 0
    const runtime = {
      ...ports,
      email: {
        async send() {
          attempts++
          throw new Error('fixture rejection')
        },
      },
    }
    await queueBookingMail(
      runtime,
      booking,
      'confirmation',
      { to: host.email, subject: 'Test', text: '', html: '' },
      'Host',
      '',
    )
    const pending = queued[0]!
    await expect(handleOne(pending, runtime)).rejects.toThrow('fixture rejection')
    const row = await repos().activity!.get((await repos().activity!.list(booking.id))[0]!.id)
    await expect(retryMail(runtime, row!)).rejects.toThrow('fixture rejection')
    await handleOne(pending, runtime)
    expect(attempts).toBe(2)
  })
  it('expires only abandoned claims without replaying mail', async () => {
    const { beginActivity } = await import('../../src/adapters/booking-activity.js')
    const store = repos().activity!
    for (const [index, action] of (['confirmation', 'calendar.create', 'reminder.1h'] as const).entries()) {
      const id = (await beginActivity(ports, booking, action, 'test', host.email, 'Host', ''))!
      await store.change(id, 'queued', 'running', NOW + index)
    }
    await store.expireClaims(NOW + 2, NOW + 3)
    expect((await store.list(booking.id)).map((row) => [row.action, row.state])).toEqual(
      expect.arrayContaining([
        ['Confirmation', 'uncertain'],
        ['Calendar create', 'failed'],
        ['Reminder (1h)', 'running'],
      ]),
    )
  })
  it.each([false, true])('removed guest cancellation with second edit=%s', async (fault) => {
    const { handleOne } = await import('../../src/adapters/queue/consumer.js')
    expect((await guests('first@example.test')).ok).toBe(true)
    const cancel = queued.find((j) => j.kind === 'email' && j.message.to === 'old@example.com')!
    expect(cancel.kind).toBe('email')
    if (fault) expect((await guests('first@example.test, next@example.test')).ok).toBe(true)
    const delivered: string[] = []
    await handleOne(cancel, {
      ...ports,
      email: {
        async send(m) {
          delivered.push(m.to)
        },
      },
    })
    expect(delivered).toEqual(['old@example.com'])
  })
  it.each([false, true])(
    'recovered provider event stays addressable with concurrent edit=%s',
    async (fault) => {
      const { syncCalendar } = await import('../../src/adapters/queue/consumer.js')
      const { beginActivity } = await import('../../src/adapters/booking-activity.js')
      await repos().bookings.setExternalEventIds(booking.id, {})
      const id = (await beginActivity(
        ports,
        booking,
        'calendar.create',
        conn.id,
        host.email,
        'Organizer',
        'google',
      ))!
      await repos().activity!.change(id, 'queued', 'failed', NOW)
      const row = (await repos().activity!.get(id))!
      await repos().activity!.change(id, 'failed', 'running', NOW, { manual: true })
      let created = 0,
        removed = 0
      const updated: string[] = []
      const runtime = {
        ...ports,
        calendars: {
          get: () => ({
            async createEvent() {
              created++
              if (fault) await guests('first@example.test')
              return { id: 'created-on-provider' }
            },
            async updateEvent(
              _conn: CalendarConnection,
              _id: string,
              event: import('../../src/ports.js').ExternalEvent,
            ) {
              updated.push(...event.attendees.map((a) => a.email))
            },
            async deleteEvent() {
              removed++
            },
          }),
        },
      } as unknown as EnginePorts
      await syncCalendar({ kind: 'calendar.sync', bookingId: booking.id, action: 'update' }, runtime, row)
      expect(created).toBe(1)
      expect((await reload()).externalEventIds[conn.id]).toBe('created-on-provider')
      expect(removed).toBe(0)
      if (fault) expect(updated).toContain('first@example.test')
    },
  )
  it.each([false, true])('send reaches a final state with journal interruption=%s', async (fault) => {
    const { queueBookingMail } = await import('../../src/adapters/booking-activity.js')
    const { handleOne } = await import('../../src/adapters/queue/consumer.js')
    await queueBookingMail(
      ports,
      booking,
      'confirmation',
      { to: host.email, html: 'fixture', text: 'fixture', subject: 'fixture' },
      'Host',
      '',
    )
    const task = queued[0]!
    let fails = fault,
      calls = 0
    const runtime = {
      ...ports,
      email: {
        async send() {
          calls++
          return { id: 'receipt' }
        },
      },
      repositories: () => {
        const r = repos(),
          store = r.activity!
        return {
          ...r,
          activity: {
            ...store,
            change: async (...args: Parameters<typeof store.change>) => {
              if (fails && args[2] === 'accepted') {
                fails = false
                throw new Error('synthetic storage interruption')
              }
              return store.change(...args)
            },
          },
        }
      },
    }
    if (fault) await expect(handleOne(task, runtime)).rejects.toThrow('synthetic storage interruption')
    else await handleOne(task, runtime)
    await handleOne(task, runtime)
    expect(calls).toBe(1)
    expect((await repos().activity!.list(booking.id))[0]?.state).not.toBe('running')
  })
})

describe('reminder recovery policy', () => {
  it('delivers edited reminder copy once after a rejection and discards the earlier envelope', async () => {
    const { retryMail } = await import('../../src/adapters/booking-activity.js')
    const { handleOne } = await import('../../src/adapters/queue/consumer.js')
    const { DEFAULT_REMINDERS } = await import('../../src/core/domain/reminders.js')
    const original = [{ minutes: 60, audience: 'guests' as const, subject: 'Original' }]
    const changed = [{ ...original[0]!, subject: 'Revised' }]
    await repos().eventTypes.saveReminders(eventType.id, DEFAULT_REMINDERS, original)
    let refuse = true
    const subjects: string[] = []
    const runtime = {
      ...ports,
      clock: { now: () => START - 60 * 60_000 },
      email: {
        async send(mail: { subject: string }) {
          if (refuse) throw new Error('recipient rejected')
          subjects.push(mail.subject)
        },
      },
    }
    const job = { kind: 'reminder' as const, bookingId: booking.id, start: START, minutes: 60 }
    await expect(handleOne(job, runtime)).rejects.toThrow()
    const store = repos().activity!
    const stale = (await store.get((await store.list(booking.id))[0]!.id))!
    await repos().eventTypes.saveReminders(eventType.id, original, changed)
    refuse = false
    await handleOne(job, runtime)
    const count = subjects.length
    expect(count).toBe(2)
    expect(subjects.every((subject) => subject.includes('Revised'))).toBe(true)
    await retryMail(runtime, stale)
    await handleOne(job, runtime)
    expect(subjects).toHaveLength(count)
  })
  it.each([false, true])(
    'respects current reminder policy during manual retry, disabled=%s',
    async (disabled) => {
      const { retryMail } = await import('../../src/adapters/booking-activity.js')
      const { handleOne } = await import('../../src/adapters/queue/consumer.js')
      const { DEFAULT_REMINDERS } = await import('../../src/core/domain/reminders.js')
      const rules = [{ minutes: 60, audience: 'guests' as const }]
      await repos().eventTypes.saveReminders(eventType.id, DEFAULT_REMINDERS, rules)
      let rejected = true
      const sent: string[] = []
      const runtime = {
        ...ports,
        clock: { now: () => START - 60 * 60_000 },
        email: {
          async send(m: { to: string }) {
            if (rejected) throw new Error('rejected by fixture')
            sent.push(m.to)
          },
        },
      }
      await expect(
        handleOne({ kind: 'reminder', bookingId: booking.id, start: START, minutes: 60 }, runtime),
      ).rejects.toThrow()
      const list = await repos().activity!.list(booking.id)
      const row = (await repos().activity!.get(list.find((r) => r.recipient === booking.guestEmail)!.id))!
      if (disabled) expect(await repos().eventTypes.saveReminders(eventType.id, rules, [])).toBe(true)
      rejected = false
      await retryMail(runtime, row)
      expect(sent).toEqual(disabled ? [] : [booking.guestEmail])
    },
  )
})
describe('native mail timeout recovery', () => {
  it.each([false, true])(
    'blocks replay of ambiguous Cloudflare timeout that mentions a domain=%s',
    async (domain) => {
      const { createCloudflareSender } = await import('../../src/adapters/email/index.js')
      const { queueBookingMail, deliverBookingMail } = await import('../../src/adapters/booking-activity.js')
      const mail = { to: host.email, subject: 'fixture', text: 'fixture', html: '' }
      let calls = 0
      const runtime = {
        ...ports,
        email: createCloudflareSender({
          from: 'sender@example.test',
          binding: {
            send: async () => {
              calls++
              throw new Error('Timeout waiting for response' + (domain ? ' from sending domain' : ''))
            },
          } as never,
        }),
      }
      await queueBookingMail(runtime, booking, 'confirmation', mail, 'Booker', '')
      const queuedMail = queued[0]!
      if (queuedMail.kind !== 'email') throw new Error('missing fixture job')
      for (let i = 0; i < 2; i++)
        await deliverBookingMail(runtime, mail, queuedMail.activityId).catch(() => {})
      expect(calls).toBe(1)
    },
  )
})
