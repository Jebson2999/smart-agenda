// Migrações do esquema. Nunca altere uma migração já publicada — adicione uma nova.
export const MIGRATIONS: string[] = [
  /* 1 — esquema inicial */ `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','coordenador','tecnico','gestor')),
  extra_permissions TEXT NOT NULL DEFAULT '[]',
  phone TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Cuiaba',
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  first_failure_at TEXT NOT NULL,
  locked_until TEXT
);

CREATE TABLE units (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  municipality TEXT,
  client TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  client TEXT,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  municipality TEXT,
  responsible_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'media',
  status TEXT NOT NULL DEFAULT 'programado',
  visibility TEXT NOT NULL DEFAULT 'compartilhado',
  notes TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  notification_settings TEXT NOT NULL DEFAULT '{"enabled":true}',
  related_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  series_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_events_dates ON events(start_date, end_date);

CREATE TABLE event_participants (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  role_label TEXT,
  attendance TEXT NOT NULL DEFAULT 'nao_solicitada',
  responded_at TEXT,
  response_channel TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_participants_event ON event_participants(event_id);

CREATE TABLE checklist_items (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'geral',
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  critical INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_checklist_event ON checklist_items(event_id);

CREATE TABLE checklist_templates (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  stage TEXT NOT NULL DEFAULT 'geral',
  items TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE event_history (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  changes TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_history_event ON event_history(event_id);

CREATE TABLE event_comments (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'documento',
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE actions (
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  responsible_name TEXT,
  responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'aberta',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  severity TEXT NOT NULL DEFAULT 'media',
  origin TEXT NOT NULL DEFAULT 'manual',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_actions_event ON actions(event_id);

CREATE TABLE custom_holidays (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'municipal',
  municipality TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE whatsapp_recipients (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  consent_status TEXT NOT NULL DEFAULT 'pendente',
  consent_at TEXT,
  consent_method TEXT,
  consent_text_version TEXT,
  consent_recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  preferences TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE wa_templates (
  id INTEGER PRIMARY KEY,
  notif_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'pt_BR',
  category TEXT NOT NULL DEFAULT 'UTILITY',
  body TEXT NOT NULL,
  variables TEXT NOT NULL DEFAULT '[]',
  buttons TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'nao_submetido',
  status_checked_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  action_id INTEGER REFERENCES actions(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES whatsapp_recipients(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL UNIQUE,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  mode TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  provider_message_id TEXT,
  lock_id TEXT,
  locked_at TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_due ON notifications(status, next_attempt_at);
CREATE INDEX idx_notifications_provider ON notifications(provider_message_id);

CREATE TABLE message_log (
  id INTEGER PRIMARY KEY,
  notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  raw TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_log_notification ON message_log(notification_id);

CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL,
  signature_valid INTEGER NOT NULL,
  payload TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE inbound_messages (
  wa_message_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE audit_trail (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TEXT NOT NULL
);
`,
];
