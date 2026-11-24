import type { GuardianRelationship, LinkVerificationStatus, StudentStatus } from '@sms/shared';

export interface Year {
  id: number;
  label: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}
export interface Grade {
  id: number;
  name: string;
  level: number;
  isActive: boolean;
}
export interface Section {
  id: number;
  name: string;
  academicYear: { id: number; label: string };
  grade: { id: number; name: string; level: number };
  classTeacher: { id: number; fullName: string } | null;
}

export interface StudentListItem {
  id: number;
  admissionNo: string;
  fullName: string;
  nameWithInitials: string | null;
  status: StudentStatus;
  currentClass: {
    id: number;
    name: string;
    grade: { id: number; name: string };
    academicYear: { id: number; label: string };
    rollNo: number | null;
  } | null;
}

export interface StudentDetail extends StudentListItem {
  dateOfBirth: string | null;
  gender: 'female' | 'male' | 'other' | null;
  admittedOn: string;
  leftOn: string | null;
  hasAccount: boolean;
  enrollments: Array<{
    id: number;
    startsOn: string;
    endsOn: string | null;
    endReason: string | null;
    rollNo: number | null;
    class: { id: number; name: string; gradeName: string; yearLabel: string };
  }>;
  statusHistory: Array<{
    id: number;
    fromStatus: StudentStatus | null;
    toStatus: StudentStatus;
    effectiveOn: string;
    reason: string;
    note: string | null;
    recordedAt: string;
  }>;
  guardians: Array<{
    id: number;
    fullName: string;
    phone: string | null;
    email: string | null;
    relationship: GuardianRelationship;
    isPrimary: boolean;
    verificationStatus: LinkVerificationStatus;
  }> | null;
}

export interface GuardianItem {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  preferredLocale: string;
  notifyEmail: boolean;
  notifySms: boolean;
  account: { id: number; identifier: string } | null;
  studentCount?: number;
}

export interface StaffItem {
  id: number;
  staffNo: string;
  fullName: string;
  nameWithInitials: string | null;
  designation: string | null;
  workEmail: string | null;
  workPhone: string | null;
  joinedOn: string | null;
  status: 'active' | 'left';
  leftOn: string | null;
  account: { id: number; displayName: string; identifier: string } | null;
}

export const STATUS_TONE: Record<StudentStatus, 'ok' | 'neutral' | 'warn'> = {
  active: 'ok',
  left: 'neutral',
  transferred: 'warn',
  graduated: 'neutral',
};
