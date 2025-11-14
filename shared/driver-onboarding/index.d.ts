export type DriverOnboardingStatus = 'draft' | 'submitted';

export interface DriverDocumentChecklistItem {
  code: string;
  label: string;
  provided: boolean;
  remarks?: string;
  attachmentPath?: string | null;
  validationStatus?: 'pending' | 'verified' | 'flagged' | null;
  flagMessage?: string | null;
  lastUploadedAt?: string | null;
}

export interface DriverJobDetails {
  positionAppliedFor: string;
  preferredLocation: string;
  payrollNumber: string;
  vehicleNumber: string;
  jobTitle: string;
  employedSince: string;
  introductionNotes?: string;
}

export interface DriverIntroductionDetails {
  introducerName: string;
  introducerPayrollNumber: string;
  introducerVehicleNumber: string;
  introducerJobTitle: string;
  introducerEmployedSince: string;
  applicantName: string;
  applicantIdNumber: string;
  reasons: string;
  relationship: string;
  knownDuration: string;
  currentEmployer: string;
  reasonsForLeaving: string;
  criminalOffences: string;
  declarationAgreement: boolean;
  signedAt: string;
  signature: string;
  managerApprovalName: string;
  managerApprovalSignature: string;
  managerApprovalDate: string;
}

export interface DriverPersonalDetails {
  surname: string;
  otherNames: string;
  dateOfBirth: string;
  ageYears: string;
  nationality: string;
  idNumber: string;
  pinNumber: string;
  nssfNumber: string;
  nhifNumber: string;
  homeDistrict: string;
  mobileNumber: string;
  emailAddress: string;
  religion: string;
  maritalStatus: string;
}

export interface DriverSpouseDetails {
  name: string;
  dateOfBirth: string;
  ageYears: string;
  idNumber: string;
  mobileNumber: string;
}

export interface DriverChildRecord {
  name: string;
  yearOfBirth: string;
  ageYears: string;
  gender: string;
}

export interface DriverNextOfKinRecord {
  label?: string;
  name: string;
  address: string;
  relationship: string;
  phone: string;
}

export interface DriverRelatedEmployeeDisclosure {
  hasRelation: boolean;
  personName: string;
  position: string;
  relationship: string;
  narrative: string;
  employeeUserId?: string | null;
}

export interface DriverHealthDisclosure {
  hasTerminalCondition: boolean;
  terminalConditionDetails: string;
  hasDisabilities: boolean;
  disabilityDetails: string;
  allergies: string;
}

export interface DriverResidence {
  postalAddress: string;
  postalCode: string;
  estate: string;
  roadOrStreet: string;
  houseNumber: string;
  plotNumber: string;
  telephone: string;
}

export interface DriverHomeAddress {
  district: string;
  division: string;
  location: string;
  subLocation: string;
  postalAddress: string;
  postalCode: string;
  areaChiefName: string;
  areaChiefTel: string;
  areaChiefPostalAddress: string;
}

export interface DriverAcademicRecord {
  period: string;
  institution: string;
  course: string;
  certificate: string;
}

export interface DriverEmploymentRecord {
  employer: string;
  periodFrom: string;
  periodTo: string;
  jobTitle: string;
  reasonForLeaving: string;
  contactPerson: string;
  contactDetails: string;
}

export interface DriverCriminalRecordEntry {
  date: string;
  nature: string;
  penalty: string;
}

export interface DriverMisconductEntry {
  date: string;
  reason: string;
}

export interface DriverRefereeRecord {
  label?: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  knownDuration: string;
  notes?: string;
}

export interface DriverDeclarationsSection {
  statementA: boolean;
  statementB: boolean;
  statementC: boolean;
  statementD: boolean;
  applicantName: string;
  signature: string;
  signedAt: string;
}

export interface DriverVerificationSection {
  verifiedBy: string;
  signature: string;
  verifiedAt: string;
  notes: string;
}

export interface DriverOnboardingForm {
  driverId: string;
  status: DriverOnboardingStatus;
  updatedAt?: string | null;
  submittedAt?: string | null;
  owner?: {
    id: string;
    name: string;
    email: string;
    phone: string;
    type: 'driver' | 'user';
  } | null;
  jobDetails: DriverJobDetails;
  introduction: DriverIntroductionDetails;
  personalDetails: DriverPersonalDetails;
  spouse: DriverSpouseDetails;
  children: DriverChildRecord[];
  nextOfKin: DriverNextOfKinRecord[];
  relatedEmployeeDisclosure: DriverRelatedEmployeeDisclosure;
  healthDisclosure: DriverHealthDisclosure;
  residentialAddress: DriverResidence;
  homeAddress: DriverHomeAddress;
  academicHistory: DriverAcademicRecord[];
  skillsSummary: string;
  employmentHistory: DriverEmploymentRecord[];
  criminalHistory: { hasRecord: boolean; entries: DriverCriminalRecordEntry[] };
  misconductHistory: { hasRecord: boolean; entries: DriverMisconductEntry[] };
  referees: DriverRefereeRecord[];
  declarations: DriverDeclarationsSection;
  verification: DriverVerificationSection;
  documentsChecklist: DriverDocumentChecklistItem[];
  completionSummary?: DriverOnboardingSummary;
}

export interface DriverOnboardingPrintOptions {
  brand?: string;
  generatedAt?: string;
  driverLabel?: string;
}

export interface DriverOnboardingSummaryStep {
  id: string;
  title: string;
  complete: boolean;
  missing: string[];
}

export interface DriverOnboardingSummary {
  isComplete: boolean;
  missingFields: string[];
  missingDocuments: string[];
  steps: DriverOnboardingSummaryStep[];
  completionPercent: number;
}

export declare const DRIVER_DOCUMENTS: ReadonlyArray<{ code: string; label: string }>;

export declare function createEmptyDriverOnboardingForm(overrides?: Partial<DriverOnboardingForm>): DriverOnboardingForm;

export declare function renderDriverOnboardingHtml(form: DriverOnboardingForm, options?: DriverOnboardingPrintOptions): string;

export declare function summarizeDriverOnboardingGaps(form?: DriverOnboardingForm | null): DriverOnboardingSummary;
