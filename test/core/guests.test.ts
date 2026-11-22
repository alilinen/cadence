import { describe, expect, it } from 'vitest'
import { parseAdditionalGuests } from '../../src/core/domain/guests.js'
import { meetingTime } from '../../src/core/domain/meeting-time.js'

describe('additional guests', () => {
  it('normalizes, deduplicates and excludes the booker', () => {
    expect(parseAdditionalGuests(' Person@EXAMPLE.com, person@example.com;\nPRIMARY@example.com', 'primary@example.com')).toEqual({ emails: ['person@example.com'] })
  })
  it('rejects invalid addresses, header injection, non-arrays and excessive recipients', () => {
    for (const value of [['bad'], ['a@example.com\r\nBcc: x@example.com'], [false], {}, Array(11).fill('a@example.com')]) {
      expect(parseAdditionalGuests(value, 'primary@example.com').error).toBeTruthy()
    }
  })
})

describe('host meeting time', () => {
  it('uses the chosen zone, independently of the server timezone', () => {
    expect(meetingTime('2027-07-05T09:30', 'Europe/London')).toEqual({ start: Date.UTC(2027, 6, 5, 8, 30) })
  })
  it('rejects invalid dates and DST gaps or ambiguous wall times', () => {
    for (const value of ['2027-02-30T09:00', '2027-03-28T01:30', '2027-10-31T01:30', '', '2027-13-01T10:00']) {
      expect(meetingTime(value, 'Europe/London').error).toBeTruthy()
    }
    expect(meetingTime('2027-07-05T09:30', 'not/a/zone').error).toBeTruthy()
  })
})
