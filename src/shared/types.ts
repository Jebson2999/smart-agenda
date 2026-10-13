import type {
  ActionOriginKey,
  ActionStatusKey,
  AttendanceKey,
  CategoryKey,
  ChecklistStage,
  ConsentStatus,
  NotificationStatus,
  NotificationType,
  Permission,
  PriorityKey,
  RoleKey,
  StatusKey,
  VisibilityKey,
} from './constants.ts';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: RoleKey;
  timezone: string;
  phone: string | null;
  permissions: Permission[];
  mustChangePassword: boolean;
}

export interface AgendaEvent {
  id: number;
  title: string;
  description: string | null;
  category: CategoryKey;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  client: string | null;
  unit_id: number | null;
  unit_name: string | null;
  municipality: string | null;
  responsible_id: number | null;
  responsible_name: string | null;
  priority: PriorityKey;
  status: StatusKey;
  visibility: VisibilityKey;
  notes: string | null;
  related_event_id: number | null;
  series_id: string | null;
  details: Record<string, unknown>;
  notification_settings: { enabled: boolean; advanceDays?: number | null };
  version: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ChecklistItem {
  id: number;
  event_id: number;
  stage: ChecklistStage;
  text: string;
  done: boolean;
  critical: boolean;
  position: number;
  notes: string | null;
  done_by: number | null;
  done_by_name?: string | null;
  done_at: string | null;
}

export interface Participant {
  id: number;
  event_id: number;
  user_id: number | null;
  name: string;
  role_label: string | null;
  attendance: AttendanceKey;
  responded_at: string | null;
  response_channel: string | null;
}

export interface ActionItem {
  id: number;
  event_id: number | null;
  event_title?: string | null;
  title: string;
  description: string | null;
  responsible_name: string | null;
  responsible_user_id: number | null;
  due_date: string | null;
  status: ActionStatusKey;
  progress: number;
  severity: PriorityKey;
  origin: ActionOriginKey;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Recipient {
  id: number;
  user_id: number | null;
  user_name?: string | null;
  name: string;
  phone: string;
  consent_status: ConsentStatus;
  consent_at: string | null;
  consent_method: string | null;
  preferences: RecipientPreferences;
  active: boolean;
}

export interface RecipientPreferences {
  types: Partial<Record<NotificationType, boolean>>;
  scope: 'todos' | 'envolvidos';
  advanceDays: number;
  advanceTime: string;
  eveTime: string;
  dayOfTime: string;
  weeklyTime: string;
}

export interface NotificationRow {
  id: number;
  type: NotificationType;
  event_id: number | null;
  action_id: number | null;
  recipient_id: number;
  dedupe_key: string;
  scheduled_for: string;
  status: NotificationStatus;
  mode: 'demo' | 'live';
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  payload: { params: string[]; preview: string; buttons?: Array<{ type: string; payload?: string; url_suffix?: string }> };
  provider_message_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}
