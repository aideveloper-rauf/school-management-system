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
  /** Set when an administrator assigns a temporary password. */
  must_change_password: Generated<number>;
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
  /** Class teacher (staff profile), migration 0005. */
  class_teacher_id: number | null;
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

export type UserTokenPurpose = 'invite' | 'reset';

export interface UserTokenTable {
  id: Generated<number>;
  user_id: number;
  purpose: UserTokenPurpose;
  /** SHA-256 of the token; NULL until the email job mints and sends it. */
  token_hash: string | null;
  expires_at: Date;
  used_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
}

// People (migration 0005) ----------------------------------------------------
export type StaffStatus = 'active' | 'left';
export interface StaffProfileTable {
  id: Generated<number>;
  staff_no: string;
  full_name: string;
  name_with_initials: string | null;
  designation: string | null;
  work_email: string | null;
  work_phone: string | null;
  joined_on: string | null;
  status: Generated<StaffStatus>;
  left_on: string | null;
  user_id: number | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type StudentStatus = 'active' | 'left' | 'transferred' | 'graduated';
export interface StudentProfileTable {
  id: Generated<number>;
  admission_no: string;
  full_name: string;
  name_with_initials: string | null;
  date_of_birth: string | null;
  gender: 'female' | 'male' | 'other' | null;
  admitted_on: string;
  status: Generated<StudentStatus>;
  left_on: string | null;
  user_id: number | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface StudentStatusEventTable {
  id: Generated<number>;
  student_id: number;
  from_status: StudentStatus | null;
  to_status: StudentStatus;
  effective_on: string;
  reason: string;
  /** Optional free text; never copied into audit metadata. */
  note: string | null;
  recorded_by: number | null;
  created_at: CreatedAt;
}

export interface EnrollmentTable {
  id: Generated<number>;
  student_id: number;
  class_section_id: number;
  academic_year_id: number;
  roll_no: number | null;
  starts_on: string;
  ends_on: string | null;
  end_reason: string | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface GuardianProfileTable {
  id: Generated<number>;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_locale: Generated<string>;
  notify_email: Generated<number>;
  notify_sms: Generated<number>;
  user_id: number | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type GuardianRelationship = 'mother' | 'father' | 'guardian' | 'other';
export type LinkVerification = 'pending' | 'verified' | 'rejected';
export interface StudentGuardianTable {
  student_id: number;
  guardian_id: number;
  relationship: GuardianRelationship;
  is_primary: Generated<number>;
  verification_status: Generated<LinkVerification>;
  verification_method: string | null;
  verified_by: number | null;
  verified_at: Date | null;
  created_at: CreatedAt;
}

export interface TeacherAssignmentTable {
  id: Generated<number>;
  staff_id: number;
  class_section_id: number;
  subject_id: number;
  created_by: number | null;
  created_at: CreatedAt;
}

export type ImportKind = 'students' | 'staff' | 'guardians';
export interface ImportJobTable {
  id: Generated<number>;
  kind: ImportKind;
  status: 'previewed' | 'applied';
  file_name: string;
  file_sha256: string;
  total_rows: Generated<number>;
  created_rows: Generated<number>;
  updated_rows: Generated<number>;
  unchanged_rows: Generated<number>;
  error_rows: Generated<number>;
  /** JSON array of { row, field, message } — never cell values. */
  errors: string | null;
  created_by: number | null;
  created_at: CreatedAt;
  applied_at: Date | null;
}

// Attendance (migration 0006) ------------------------------------------------
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export interface AttendanceSessionTable {
  id: Generated<number>;
  class_section_id: number;
  session_date: string;
  taken_by: number | null;
  taken_at: CreatedAt;
  updated_by: number | null;
  updated_at: UpdatedAt;
}
export interface AttendanceRecordTable {
  session_id: number;
  student_id: number;
  status: AttendanceStatus;
  updated_at: UpdatedAt;
}
export interface AttendanceCorrectionTable {
  id: Generated<number>;
  session_id: number;
  student_id: number;
  from_status: AttendanceStatus | null;
  to_status: AttendanceStatus;
  /** Free text; kept here only, never copied into audit metadata. */
  reason: string;
  status: Generated<'pending' | 'approved' | 'rejected'>;
  requested_by: number | null;
  decided_by: number | null;
  decided_at: Date | null;
  created_at: CreatedAt;
}

// Timetable and announcements (migration 0007) -------------------------------
export interface TimetableEntryTable {
  id: Generated<number>;
  academic_year_id: number;
  class_section_id: number;
  /** 1 = Monday … 7 = Sunday. */
  day_of_week: number;
  period_id: number;
  subject_id: number;
  staff_id: number | null;
  room_id: number | null;
  created_by: number | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}
export type AnnouncementAudience = 'school' | 'role' | 'grade' | 'class' | 'guardians_of_class';
export interface AnnouncementTable {
  id: Generated<number>;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  audience_role: string | null;
  audience_grade_id: number | null;
  audience_class_section_id: number | null;
  published_at: Date | null;
  expires_on: string | null;
  withdrawn_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}
export interface AnnouncementReadTable {
  announcement_id: number;
  user_id: number;
  read_at: CreatedAt;
}

// Learning (migration 0008) --------------------------------------------------
export interface StoredFileTable {
  id: Generated<number>;
  /** Relative path under STORAGE_DIR/files; never derived from user input. */
  storage_key: string;
  sha256: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: number | null;
  created_at: CreatedAt;
}
export interface LearningItemTable {
  id: Generated<number>;
  kind: 'resource' | 'assignment';
  class_section_id: number;
  subject_id: number;
  title: string;
  instructions: string | null;
  due_at: Date | null;
  allow_late: Generated<number>;
  /** DECIMAL comes back as a string from mysql2. */
  max_score: string | null;
  published_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}
export interface LearningItemFileTable {
  item_id: number;
  file_id: number;
}
export interface SubmissionTable {
  id: Generated<number>;
  item_id: number;
  student_id: number;
  text_answer: string | null;
  submitted_at: UpdatedAt;
  is_late: Generated<number>;
  status: Generated<'submitted' | 'returned'>;
  feedback: string | null;
  score: string | null;
  returned_by: number | null;
  returned_at: Date | null;
}
export interface SubmissionFileTable {
  submission_id: number;
  file_id: number;
}

// Question bank and papers (migration 0009) ----------------------------------
export interface QuestionTable {
  id: Generated<number>;
  subject_id: number;
  grade_id: number | null;
  language: string;
  outcome: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  is_retired: Generated<number>;
  created_by: number | null;
  created_at: CreatedAt;
}
export interface QuestionVersionTable {
  id: Generated<number>;
  question_id: number;
  version: number;
  kind: 'mcq' | 'short' | 'essay';
  stem: string;
  /** JSON: [{ text, correct }] for MCQ. */
  options: string | null;
  /** Model answer / marking scheme — the answer key. */
  answer: string | null;
  marks: string;
  licence: string | null;
  source: string | null;
  review_status: Generated<'draft' | 'in_review' | 'approved' | 'rejected'>;
  reviewed_by: number | null;
  reviewed_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
}
export interface ExamPaperTable {
  id: Generated<number>;
  title: string;
  subject_id: number;
  grade_id: number;
  created_by: number | null;
  created_at: CreatedAt;
}
export interface ExamPaperVersionTable {
  id: Generated<number>;
  paper_id: number;
  version: number;
  instructions: string | null;
  duration_minutes: number | null;
  status: Generated<'draft' | 'final'>;
  finalized_by: number | null;
  finalized_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
}
export interface ExamPaperItemTable {
  paper_version_id: number;
  position: number;
  question_version_id: number;
  marks: string;
}

export interface Database {
  questions: QuestionTable;
  question_versions: QuestionVersionTable;
  exam_papers: ExamPaperTable;
  exam_paper_versions: ExamPaperVersionTable;
  exam_paper_items: ExamPaperItemTable;
  stored_files: StoredFileTable;
  learning_items: LearningItemTable;
  learning_item_files: LearningItemFileTable;
  submissions: SubmissionTable;
  submission_files: SubmissionFileTable;
  timetable_entries: TimetableEntryTable;
  announcements: AnnouncementTable;
  announcement_reads: AnnouncementReadTable;
  attendance_sessions: AttendanceSessionTable;
  attendance_records: AttendanceRecordTable;
  attendance_corrections: AttendanceCorrectionTable;
  staff_profiles: StaffProfileTable;
  student_profiles: StudentProfileTable;
  student_status_events: StudentStatusEventTable;
  enrollments: EnrollmentTable;
  guardian_profiles: GuardianProfileTable;
  student_guardians: StudentGuardianTable;
  teacher_assignments: TeacherAssignmentTable;
  import_jobs: ImportJobTable;
  user_tokens: UserTokenTable;
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
