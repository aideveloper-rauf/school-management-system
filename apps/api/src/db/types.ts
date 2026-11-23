import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | string | undefined, Date | string>;

/** The single school this installation serves (one row). */
export interface SchoolTable {
  id: Generated<number>;
  name: string;
  short_name: string | null;
  default_locale: string;
  timezone: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface UserTable {
  id: Generated<number>;
  /** Lower-cased email or school-issued username. */
  identifier: string;
  display_name: string;
  password_hash: string;
  locale: string;
  status: 'active' | 'disabled' | 'invited';
  password_changed_at: Date | null;
  last_login_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface UserRoleTable {
  user_id: number;
  role: string;
  granted_by: number | null;
  granted_at: CreatedAt;
}

export interface SessionTable {
  /** SHA-256 of the session token; the raw token only lives in the cookie. */
  id_hash: string;
  user_id: number;
  csrf_token: string;
  expires_at: Date;
  created_at: CreatedAt;
  last_seen_at: Date;
  user_agent: string | null;
}

export interface LoginAttemptTable {
  id: Generated<number>;
  identifier: string;
  ip: string;
  succeeded: number;
  attempted_at: CreatedAt;
}

export interface AuditEventTable {
  id: Generated<number>;
  actor_user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  /** Non-sensitive context (ids, field names, reasons) — never passwords or tokens. */
  metadata: string | null;
  ip: string | null;
  request_id: string | null;
  created_at: CreatedAt;
}

export interface AcademicYearTable {
  id: Generated<number>;
  label: string;
  starts_on: string;
  ends_on: string;
  is_current: number;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface TermTable {
  id: Generated<number>;
  academic_year_id: number;
  label: string;
  sequence: number;
  starts_on: string;
  ends_on: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface JobTable {
  id: Generated<number>;
  type: string;
  payload: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  max_attempts: number;
  run_after: Date;
  locked_at: Date | null;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface AppMetaTable {
  meta_key: string;
  meta_value: string;
  updated_at: UpdatedAt;
}

export interface GradeTable {
  id: Generated<number>;
  name: string;
  level: number;
  is_active: number;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface SubjectTable {
  id: Generated<number>;
  code: string;
  name: string;
  name_si: string | null;
  name_ta: string | null;
  is_active: number;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface GradeSubjectTable {
  grade_id: number;
  subject_id: number;
  is_optional: number;
}

export interface RoomTable {
  id: Generated<number>;
  name: string;
  capacity: number | null;
  is_active: number;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ClassSectionTable {
  id: Generated<number>;
  academic_year_id: number;
  grade_id: number;
  name: string;
  medium: string | null;
  capacity: number | null;
  home_room_id: number | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PeriodDefinitionTable {
  id: Generated<number>;
  label: string;
  sequence: number;
  /** `HH:MM:SS` (mysql2 returns TIME as a string). */
  starts_at: string;
  ends_at: string;
  is_break: number;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface CalendarEventTable {
  id: Generated<number>;
  academic_year_id: number | null;
  title: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  is_school_day: number;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface Database {
  grades: GradeTable;
  subjects: SubjectTable;
  grade_subjects: GradeSubjectTable;
  rooms: RoomTable;
  class_sections: ClassSectionTable;
  period_definitions: PeriodDefinitionTable;
  calendar_events: CalendarEventTable;
  schools: SchoolTable;
  users: UserTable;
  user_roles: UserRoleTable;
  sessions: SessionTable;
  login_attempts: LoginAttemptTable;
  audit_events: AuditEventTable;
  academic_years: AcademicYearTable;
  terms: TermTable;
  jobs: JobTable;
  app_meta: AppMetaTable;
}

export type User = Selectable<UserTable>;
export type NewUser = Insertable<UserTable>;
export type UserUpdate = Updateable<UserTable>;
