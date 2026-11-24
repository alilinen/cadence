-- Existing invitations retain their original identity. New bookings freeze the
-- provider UID before their first email; reschedules transfer it with the event.
ALTER TABLE bookings ADD COLUMN invitation_uid TEXT;
ALTER TABLE bookings ADD COLUMN invitation_organizer TEXT;
