# Cadence roadmap

These priorities reflect Cadence’s focus on teams embedding a self-hosted scheduler. The backlog is ordered for discussion and has no release dates.

## Current release

- Explain a start time using actual host availability and calendar checks. Let each event type choose how to handle a calendar outage.
- Trace individual booking notifications and organizer calendar writes. Recover a failed operation without notifying the whole meeting again.

## Next

| Priority | Feature | First usable version |
| --- | --- | --- |
| 3 | Embed completion | An origin-checked, versioned success callback, inline and modal examples, and a copyable embed configurator. Keep private booking details out of browser events. |
| 4 | Suggest times | Copy real slots in the guest’s timezone with a booking link and alternatives if a slot fills. |
| 5 | Calendar health | Show the latest successful check and write destination across connections. Add inbound Outlook changes for recorded organizer events. |
| 6 | Private booking links | Expiring, single-use links with optional guest verification or host approval. |
| 7 | Intake routing | Ordered rules, a fallback route and a preview. Carry the guest’s answers through booking. |
| 8 | Attendance | One-click reconfirmation, per-person no-shows and an optional rebooking email. |

## Later

| Priority | Feature | First usable version |
| --- | --- | --- |
| 9 | External group polls | Account-free voting, optional private responses and a final availability check. |
| 10 | Seats and waitlists | Independent reservations for one occurrence, atomic capacity limits and timed offers for freed seats. |
| 11 | Recurring meetings | A finite weekly series with conflict preview and single-occurrence changes across daylight-saving transitions. |
| 12 | CalDAV | Pilot read-only busy checks against one named provider, including recurring exceptions and all-day events. |
| 13 | Preferred times and guest overlay | Highlight preferred starts first. Test an optional private overlay of the guest’s calendar. |
| 14 | Paid services | Start with one payment provider, deposits, refunds and rescheduling. Evaluate packages, credits and resources after that. |

## Adoption experiment

Pilot an event-type importer with a dry run. Let operators review slugs, durations, questions, buffers and working hours before saving drafts. Measure the time to a first equivalent booking.
