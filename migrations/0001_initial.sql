-- Cadence initial database schema.
-- Apply with the migration runner; do not edit after the public release.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  tz          TEXT NOT NULL DEFAULT 'UTC',
  slug        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  avatar_key TEXT,
  company TEXT,
  job_title TEXT,
  company_url TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  digest_hour INTEGER,
  digest_sent_on TEXT,
  appearance_json TEXT
);

CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  logo_key TEXT,
  logo_shape TEXT NOT NULL DEFAULT 'circle',
  show_name INTEGER NOT NULL DEFAULT 1,
  appearance_json TEXT
);

CREATE TABLE team_members (
  team_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  rr_weight  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE event_types (
  id                     TEXT PRIMARY KEY,
  owner_user_id          TEXT,
  owner_team_id          TEXT,
  scheduling_type        TEXT NOT NULL DEFAULT 'personal',
  slug                   TEXT NOT NULL,
  title                  TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  duration_minutes       INTEGER NOT NULL,
  slot_interval_minutes  INTEGER,
  buffer_before_minutes  INTEGER NOT NULL DEFAULT 0,
  buffer_after_minutes   INTEGER NOT NULL DEFAULT 0,
  min_notice_minutes     INTEGER NOT NULL DEFAULT 0,
  max_horizon_days       INTEGER NOT NULL DEFAULT 60,
  max_per_day            INTEGER,
  location_type          TEXT NOT NULL DEFAULT 'google_meet',
  location_value         TEXT,
  questions_json         TEXT NOT NULL DEFAULT '[]',
  active                 INTEGER NOT NULL DEFAULT 1,
  created_at             INTEGER NOT NULL,
  schedule_id TEXT,
  logo_key TEXT,
  logo_shape TEXT NOT NULL DEFAULT 'circle',
  one_off INTEGER NOT NULL DEFAULT 0,
  public_agenda TEXT,
  reminder_rules_json TEXT NOT NULL DEFAULT '[{"minutes":1440,"audience":"both"},{"minutes":60,"audience":"both"}]'
);

CREATE TABLE availability_schedules (
  user_id        TEXT PRIMARY KEY,
  timezone       TEXT NOT NULL,
  weekly_json    TEXT NOT NULL,
  overrides_json TEXT NOT NULL DEFAULT '[]',
  updated_at     INTEGER NOT NULL
);

CREATE TABLE calendar_connections (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL,
  provider               TEXT NOT NULL,
  provider_account_email TEXT NOT NULL DEFAULT '',
  encrypted_tokens       TEXT NOT NULL,
  key_version            INTEGER NOT NULL DEFAULT 1,
  calendar_ids_read_json TEXT NOT NULL DEFAULT '[]',
  calendar_id_write      TEXT,
  sync_status            TEXT NOT NULL DEFAULT 'ok',
  created_at             INTEGER NOT NULL
);

CREATE TABLE bookings (
  id                       TEXT PRIMARY KEY,
  event_type_id            TEXT NOT NULL,
  host_user_id             TEXT NOT NULL,
  host_user_ids_json       TEXT NOT NULL DEFAULT '[]',
  guest_name               TEXT NOT NULL,
  guest_email              TEXT NOT NULL,
  guest_timezone           TEXT NOT NULL DEFAULT 'UTC',
  start_utc                INTEGER NOT NULL,
  end_utc                  INTEGER NOT NULL,
  local_date               TEXT NOT NULL DEFAULT '',
  status                   TEXT NOT NULL DEFAULT 'confirmed',
  answers_json             TEXT NOT NULL DEFAULT '{}',
  external_event_ids_json  TEXT NOT NULL DEFAULT '{}',
  reschedule_of            TEXT,
  rescheduled_to           TEXT,
  manage_token_hash        TEXT NOT NULL,
  cancelled_at             INTEGER,
  created_at               INTEGER NOT NULL,
  conference_url TEXT,
  confirmation_queued_at INTEGER,
  additional_guests_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0,
  edit_token TEXT NOT NULL DEFAULT '',
  calendar_sync_revision INTEGER NOT NULL DEFAULT -1,
  calendar_checked_at INTEGER NOT NULL DEFAULT 0,
  calendar_sync_error TEXT
);

CREATE TABLE slot_locks (
  host_user_id TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  booking_id   TEXT NOT NULL,
  PRIMARY KEY (host_user_id, bucket_start)
);

CREATE TABLE slot_holds (
  host_user_id  TEXT NOT NULL,
  bucket_start  INTEGER NOT NULL,
  hold_id       TEXT NOT NULL,
  event_type_id TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (host_user_id, bucket_start, hold_id)
);

CREATE TABLE sessions (
  id_hash             TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  expires_at          INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  bookmark            TEXT,
  created_at          INTEGER NOT NULL
);

CREATE TABLE magic_link_tokens (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  timezone TEXT
);

CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  hash_sha256  TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  scopes_json  TEXT NOT NULL DEFAULT '[]',
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE webhooks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,
  events_json TEXT NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE idempotency_keys (
  key           TEXT NOT NULL,
  scope         TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status        INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  PRIMARY KEY (key, scope)
);

CREATE TABLE rr_assignments (
  team_id          TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  last_assigned_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE instance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE schedules (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0,
  timezone      TEXT NOT NULL,
  weekly_json   TEXT NOT NULL,
  overrides_json TEXT NOT NULL DEFAULT '[]',
  updated_at    INTEGER NOT NULL,
  created_by TEXT,
  updated_by TEXT
);

CREATE TABLE slug_claims (
  slug       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE event_type_hosts (
  event_type_id TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  required      INTEGER NOT NULL DEFAULT 1,
  schedule_id   TEXT,
  rr_weight     INTEGER,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_type_id, user_id)
);

CREATE TABLE notification_channels (
  id            TEXT PRIMARY KEY,
  owner_kind    TEXT NOT NULL,
  owner_id      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  label         TEXT NOT NULL,
  config_enc    TEXT NOT NULL,
  key_version   INTEGER NOT NULL,
  events_json   TEXT NOT NULL DEFAULT '[]',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE TABLE calendar_shares (
  owner_id TEXT NOT NULL,
  viewer_id TEXT NOT NULL CHECK (owner_id <> viewer_id),
  team_id TEXT NOT NULL,
  calendars_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, viewer_id),
  FOREIGN KEY (team_id, owner_id) REFERENCES team_members(team_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, viewer_id) REFERENCES team_members(team_id, user_id) ON DELETE CASCADE
);

CREATE TABLE reminder_deliveries (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  start_utc INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  delivered_at INTEGER,
  PRIMARY KEY (booking_id, start_utc, minutes, recipient)
);

CREATE TABLE booking_activity (
  id TEXT PRIMARY KEY,
  bookingId TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  role TEXT NOT NULL,
  recipient TEXT NOT NULL,
  detail TEXT NOT NULL,
  state TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  retried INTEGER NOT NULL DEFAULT 0,
  transitions TEXT NOT NULL DEFAULT '[]',
  payload TEXT,
  receipt TEXT,
  validity TEXT,
  operationId TEXT,
  operation TEXT GENERATED ALWAYS AS (
  coalesce(operationId, CASE action
    WHEN 'Confirmation' THEN 'confirmation'
    WHEN 'Reschedule' THEN 'reschedule'
    WHEN 'Cancellation' THEN 'cancellation'
    WHEN 'Participants updated' THEN 'participants.updated'
    WHEN 'Participant removed' THEN 'participant.removed'
    WHEN 'Host added' THEN 'host.added'
    WHEN 'Host removed' THEN 'host.removed'
    WHEN 'Calendar create' THEN 'calendar.create'
    WHEN 'Calendar update' THEN 'calendar.update'
    WHEN 'Calendar delete' THEN 'calendar.delete'
    WHEN 'Calendar join link' THEN 'calendar.join_link'
    WHEN 'Availability check' THEN 'availability.check'
    WHEN 'Reminder (1h)' THEN 'reminder.1h'
    WHEN 'Reminder (24h)' THEN 'reminder.24h'
    ELSE CASE WHEN action = printf('Reminder (%d min)', cast(substr(action,11) AS INTEGER))
                   AND cast(substr(action,11) AS INTEGER) > 0
              THEN printf('reminder.%dm',cast(substr(action,11) AS INTEGER))
              ELSE 'unknown' END
  END)
) VIRTUAL
);

CREATE UNIQUE INDEX users_email_idx ON users (email);

CREATE UNIQUE INDEX users_slug_idx  ON users (slug);

CREATE UNIQUE INDEX teams_slug_idx ON teams (slug);

CREATE INDEX team_members_user_idx ON team_members (user_id);

CREATE INDEX event_types_owner_user_idx ON event_types (owner_user_id);

CREATE INDEX event_types_owner_team_idx ON event_types (owner_team_id);

CREATE UNIQUE INDEX event_types_user_slug_idx ON event_types (owner_user_id, slug);

CREATE UNIQUE INDEX event_types_team_slug_idx ON event_types (owner_team_id, slug);

CREATE INDEX calendar_connections_user_idx ON calendar_connections (user_id);

CREATE INDEX bookings_host_start_idx      ON bookings (host_user_id, start_utc);

CREATE INDEX bookings_host_local_date_idx ON bookings (host_user_id, local_date);

CREATE INDEX bookings_event_type_idx      ON bookings (event_type_id);

CREATE INDEX bookings_guest_email_idx     ON bookings (guest_email);

CREATE UNIQUE INDEX bookings_manage_token_idx ON bookings (manage_token_hash);

CREATE INDEX slot_locks_booking_idx ON slot_locks (booking_id);

CREATE INDEX slot_holds_expiry_idx ON slot_holds (expires_at);

CREATE INDEX slot_holds_hold_idx   ON slot_holds (hold_id);

CREATE INDEX sessions_user_idx   ON sessions (user_id);

CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE INDEX magic_link_expiry_idx ON magic_link_tokens (expires_at);

CREATE UNIQUE INDEX api_keys_prefix_idx ON api_keys (prefix);

CREATE INDEX api_keys_user_idx ON api_keys (user_id);

CREATE INDEX webhooks_user_idx ON webhooks (user_id);

CREATE INDEX idempotency_expiry_idx ON idempotency_keys (expires_at);

CREATE INDEX schedules_user_idx ON schedules(user_id);

CREATE UNIQUE INDEX schedules_user_default_idx
  ON schedules(user_id) WHERE is_default = 1;

CREATE INDEX slug_claims_owner_idx ON slug_claims (kind, owner_id);

CREATE INDEX event_type_hosts_user_idx ON event_type_hosts (user_id);

CREATE INDEX notification_channels_owner_idx ON notification_channels (owner_kind, owner_id);

CREATE INDEX bookings_calendar_check_idx ON bookings(status, calendar_checked_at);

CREATE INDEX calendar_shares_viewer ON calendar_shares(viewer_id);

CREATE INDEX booking_activity_history ON booking_activity(bookingId,created);

CREATE INDEX booking_activity_running ON booking_activity(updated) WHERE state='running';
