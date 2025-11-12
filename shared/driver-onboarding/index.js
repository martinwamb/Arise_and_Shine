const DRIVER_DOCUMENTS = [
  { code: 'national_id', label: 'Copy of National Identification Card or Passport' },
  { code: 'nhif', label: 'Copy of N.H.I.F. card' },
  { code: 'nssf', label: 'Copy of N.S.S.F. card' },
  { code: 'kra_pin', label: 'Copy of K.R.A. PIN certificate' },
  { code: 'good_conduct', label: 'Copy of current certificate of good conduct' },
  { code: 'photos', label: '3 coloured passport sized photographs' },
  { code: 'application_pack', label: 'Application letter, CV, academic & professional certificates & testimonials' },
  { code: 'driving_licence', label: 'Copy of valid driving licence' },
  { code: 'spouse_id', label: "Copy of spouse's identification card or passport" },
];

const DEFAULT_CHILD_ROWS = 3;
const DEFAULT_ACADEMIC_ROWS = 2;
const DEFAULT_EMPLOYMENT_ROWS = 3;
const DEFAULT_REFEREES = 3;

function todayISO(){
  return new Date().toISOString().slice(0, 10);
}

function createRepeatingRows(count, factory){
  const items = [];
  for(let i=0; i<count; i+=1){
    items.push(factory(i));
  }
  return items;
}

export function createEmptyDriverOnboardingForm(overrides={}){
  const iso = new Date().toISOString();
  const base = {
    driverId: '',
    status: 'draft',
    updatedAt: iso,
    submittedAt: null,
    jobDetails: {
      positionAppliedFor: '',
      preferredLocation: '',
      payrollNumber: '',
      vehicleNumber: '',
      jobTitle: '',
      employedSince: '',
      introductionNotes: '',
    },
    introduction: {
      introducerName: '',
      introducerPayrollNumber: '',
      introducerVehicleNumber: '',
      introducerJobTitle: '',
      introducerEmployedSince: '',
      applicantName: '',
      applicantIdNumber: '',
      reasons: '',
      relationship: '',
      knownDuration: '',
      currentEmployer: '',
      reasonsForLeaving: '',
      criminalOffences: '',
      declarationAgreement: true,
      signedAt: '',
      signature: '',
      managerApprovalName: '',
      managerApprovalSignature: '',
      managerApprovalDate: '',
    },
    personalDetails: {
      surname: '',
      otherNames: '',
      dateOfBirth: '',
      ageYears: '',
      nationality: '',
      idNumber: '',
      pinNumber: '',
      nssfNumber: '',
      nhifNumber: '',
      homeDistrict: '',
      mobileNumber: '',
      emailAddress: '',
      religion: '',
      maritalStatus: 'Single',
    },
    spouse: {
      name: '',
      dateOfBirth: '',
      ageYears: '',
      idNumber: '',
      mobileNumber: '',
    },
    children: createRepeatingRows(DEFAULT_CHILD_ROWS, () => ({ name: '', yearOfBirth: '', ageYears: '', gender: '' })),
    nextOfKin: [
      { label: '1st next of kin', name: '', address: '', relationship: '', phone: '' },
      { label: '2nd next of kin', name: '', address: '', relationship: '', phone: '' },
    ],
    relatedEmployeeDisclosure: {
      hasRelation: false,
      personName: '',
      position: '',
      relationship: '',
      narrative: '',
    },
    healthDisclosure: {
      hasTerminalCondition: false,
      terminalConditionDetails: '',
      hasDisabilities: false,
      disabilityDetails: '',
      allergies: '',
    },
    residentialAddress: {
      postalAddress: '',
      postalCode: '',
      estate: '',
      roadOrStreet: '',
      houseNumber: '',
      plotNumber: '',
      telephone: '',
    },
    homeAddress: {
      district: '',
      division: '',
      location: '',
      subLocation: '',
      postalAddress: '',
      postalCode: '',
      areaChiefName: '',
      areaChiefTel: '',
      areaChiefPostalAddress: '',
    },
    academicHistory: createRepeatingRows(DEFAULT_ACADEMIC_ROWS, () => ({ period: '', institution: '', course: '', certificate: '' })),
    skillsSummary: '',
    employmentHistory: createRepeatingRows(DEFAULT_EMPLOYMENT_ROWS, () => ({ employer: '', periodFrom: '', periodTo: '', jobTitle: '', reasonForLeaving: '', contactPerson: '', contactDetails: '' })),
    criminalHistory: {
      hasRecord: false,
      entries: [{ date: '', nature: '', penalty: '' }],
    },
    misconductHistory: {
      hasRecord: false,
      entries: [{ date: '', reason: '' }],
    },
    referees: createRepeatingRows(DEFAULT_REFEREES, (index) => ({
      label: `Referee ${index + 1}`,
      name: '',
      relationship: '',
      phone: '',
      email: '',
      knownDuration: '',
      notes: '',
    })),
    declarations: {
      statementA: false,
      statementB: false,
      statementC: false,
      statementD: false,
      applicantName: '',
      signature: '',
      signedAt: todayISO(),
    },
    verification: {
      verifiedBy: '',
      signature: '',
      verifiedAt: '',
      notes: '',
    },
    documentsChecklist: DRIVER_DOCUMENTS.map((doc) => ({
      code: doc.code,
      label: doc.label,
      provided: false,
      remarks: '',
      attachmentPath: null,
    })),
  };
  return {
    ...base,
    ...overrides,
    documentsChecklist: (overrides.documentsChecklist || base.documentsChecklist).map((item, index) => ({
      code: item.code || base.documentsChecklist[index]?.code || DRIVER_DOCUMENTS[index]?.code || `doc_${index}`,
      label: item.label || base.documentsChecklist[index]?.label || DRIVER_DOCUMENTS[index]?.label || item.label || 'Document',
      provided: Boolean(item.provided),
      remarks: item.remarks || '',
      attachmentPath: item.attachmentPath || null,
    })),
  };
}

function escapeHtml(value){
  if(value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function formatBool(value){
  return value ? 'Yes' : 'No';
}

function renderTableRows(pairs){
  return pairs
    .filter((pair) => pair && pair.length === 2)
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value || '')}</td></tr>`)
    .join('');
}

function renderArrayTable(columns, rows){
  const header = columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join('');
  const body = rows
    .map((row) =>
      `<tr>${columns
        .map((col) => `<td>${escapeHtml(row[col.key] ?? '')}</td>`)
        .join('')}</tr>`
    )
    .join('');
  return `<table class="grid"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderDriverOnboardingHtml(form, options={}){
  const payload = form || createEmptyDriverOnboardingForm();
  const brand = options.brand || 'Arise & Shine Transporters';
  const driverLabel = options.driverLabel || payload.personalDetails?.surname || payload.driverId || 'Driver';
  const generatedAt = options.generatedAt || new Date().toLocaleString();
  const intro = payload.introduction || {};
  const health = payload.healthDisclosure || {};
  const address = payload.residentialAddress || {};
  const home = payload.homeAddress || {};
  const jobDetails = payload.jobDetails || {};
  const personal = payload.personalDetails || {};
  const spouse = payload.spouse || {};
  const documents = payload.documentsChecklist || [];

  const childrenTable = renderArrayTable(
    [
      { key: 'name', label: 'Child name' },
      { key: 'yearOfBirth', label: 'Year of birth' },
      { key: 'ageYears', label: 'Age' },
      { key: 'gender', label: 'Gender' },
    ],
    payload.children || []
  );

  const academicTable = renderArrayTable(
    [
      { key: 'period', label: 'Period' },
      { key: 'institution', label: 'School/College/University' },
      { key: 'course', label: 'Course studied' },
      { key: 'certificate', label: 'Certificates awarded' },
    ],
    payload.academicHistory || []
  );

  const employmentTable = renderArrayTable(
    [
      { key: 'employer', label: 'Employer' },
      { key: 'periodFrom', label: 'From' },
      { key: 'periodTo', label: 'To' },
      { key: 'jobTitle', label: 'Job title' },
      { key: 'reasonForLeaving', label: 'Reason for leaving' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'contactDetails', label: 'Telephone / Email' },
    ],
    payload.employmentHistory || []
  );

  const refereeTable = renderArrayTable(
    [
      { key: 'label', label: 'Reference' },
      { key: 'name', label: 'Name' },
      { key: 'relationship', label: 'Relationship' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'knownDuration', label: 'Known duration' },
    ],
    payload.referees || []
  );

  const documentTable = renderArrayTable(
    [
      { key: 'label', label: 'Document' },
      { key: 'provided', label: 'Provided' },
      { key: 'remarks', label: 'Remarks' },
    ],
    documents.map((doc) => ({
      label: doc.label,
      provided: formatBool(doc.provided),
      remarks: doc.remarks || '',
    }))
  );

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Driver onboarding - ${escapeHtml(driverLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 32px; color: #0f172a; }
  header { text-align: center; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
  h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; text-transform: uppercase; color: #475569; }
  h3 { font-size: 14px; margin: 16px 0 8px; color: #475569; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.kv th { width: 30%; text-align: left; padding: 6px 8px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: 600; }
  table.kv td { padding: 6px 8px; border: 1px solid #e2e8f0; }
  table.grid th, table.grid td { padding: 6px 8px; border: 1px solid #e2e8f0; text-align: left; }
  table.grid thead th { background: #f1f5f9; font-size: 12px; }
  section { page-break-inside: avoid; }
  footer { margin-top: 24px; font-size: 12px; color: #64748b; text-align: right; }
  .badge { display: inline-block; padding: 4px 8px; border-radius: 999px; font-size: 12px; background: #e0f2fe; color: #0369a1; text-transform: uppercase; }
</style>
</head>
<body>
  <header>
    <div class="badge">${escapeHtml(payload.status || 'draft')}</div>
    <h1>${escapeHtml(brand)} &mdash; Driver Registration Form</h1>
    <p>Driver: ${escapeHtml(`${personal.surname || ''} ${personal.otherNames || ''}`.trim() || driverLabel)} &bull; ID: ${escapeHtml(payload.driverId || personal.idNumber || 'N/A')}</p>
  </header>

  <section>
    <h2>Job & introduction details</h2>
    <table class="kv">
      ${renderTableRows([
        ['Position applied for', jobDetails.positionAppliedFor],
        ['Preferred location', jobDetails.preferredLocation],
        ['Payroll number', jobDetails.payrollNumber],
        ['Vehicle number', jobDetails.vehicleNumber],
        ['Job title', jobDetails.jobTitle],
        ['Employed since', jobDetails.employedSince],
      ])}
    </table>
    <table class="kv">
      ${renderTableRows([
        ['Introducer name', intro.introducerName],
        ['Introducer payroll no.', intro.introducerPayrollNumber],
        ['Introducer vehicle no.', intro.introducerVehicleNumber],
        ['Introducer job title', intro.introducerJobTitle],
        ['Introducer employed since', intro.introducerEmployedSince],
        ['Applicant name', intro.applicantName],
        ['Applicant ID number', intro.applicantIdNumber],
        ['Relationship with applicant', intro.relationship],
        ['How long known', intro.knownDuration],
        ['Current employer', intro.currentEmployer],
        ['Reasons for introduction', intro.reasons],
        ['Reasons for leaving previous employer', intro.reasonsForLeaving],
        ['Criminal offences known', intro.criminalOffences],
      ])}
    </table>
  </section>

  <section>
    <h2>Personal details</h2>
    <table class="kv">
      ${renderTableRows([
        ['Surname', personal.surname],
        ['Other names', personal.otherNames],
        ['Date of birth', personal.dateOfBirth],
        ['Age (years)', personal.ageYears],
        ['Nationality', personal.nationality],
        ['ID/Passport No.', personal.idNumber],
        ['PIN No.', personal.pinNumber],
        ['NSSF No.', personal.nssfNumber],
        ['NHIF No.', personal.nhifNumber],
        ['Home district', personal.homeDistrict],
        ['Mobile number', personal.mobileNumber],
        ['Email address', personal.emailAddress],
        ['Religion', personal.religion],
        ['Marital status', personal.maritalStatus],
      ])}
    </table>
    <h3>Spouse details</h3>
    <table class="kv">
      ${renderTableRows([
        ['Name of spouse', spouse.name],
        ['Date of birth', spouse.dateOfBirth],
        ['Age (years)', spouse.ageYears],
        ['ID/Passport No.', spouse.idNumber],
        ['Mobile number', spouse.mobileNumber],
      ])}
    </table>
    <h3>Children</h3>
    ${childrenTable}
  </section>

  <section>
    <h2>Contacts & residence</h2>
    <h3>Next of kin</h3>
    ${renderArrayTable(
      [
        { key: 'label', label: 'Contact' },
        { key: 'name', label: 'Full names' },
        { key: 'address', label: 'Postal address & code' },
        { key: 'relationship', label: 'Relationship' },
        { key: 'phone', label: 'Phone' },
      ],
      payload.nextOfKin || []
    )}
    <table class="kv">
      ${renderTableRows([
        ['Related to Arise & Shine employee?', formatBool(payload.relatedEmployeeDisclosure?.hasRelation)],
        ['Employee name', payload.relatedEmployeeDisclosure?.personName],
        ['Position', payload.relatedEmployeeDisclosure?.position],
        ['Relationship', payload.relatedEmployeeDisclosure?.relationship],
        ['Details', payload.relatedEmployeeDisclosure?.narrative],
      ])}
    </table>
    <h3>Residential address</h3>
    <table class="kv">
      ${renderTableRows([
        ['Present postal address', address.postalAddress],
        ['Postal code', address.postalCode],
        ['Estate', address.estate],
        ['Road / Street', address.roadOrStreet],
        ['House / Flat No.', address.houseNumber],
        ['Plot No.', address.plotNumber],
        ['House telephone', address.telephone],
      ])}
    </table>
    <h3>Home address</h3>
    <table class="kv">
      ${renderTableRows([
        ['Home district / county', home.district],
        ['Division', home.division],
        ['Location', home.location],
        ['Sub-location', home.subLocation],
        ['Postal address', home.postalAddress],
        ['Postal code', home.postalCode],
        ['Area chief name', home.areaChiefName],
        ['Area chief tel', home.areaChiefTel],
        ['Area chief postal address', home.areaChiefPostalAddress],
      ])}
    </table>
  </section>

  <section>
    <h2>Health declaration</h2>
    <table class="kv">
      ${renderTableRows([
        ['Terminal medical condition?', formatBool(health.hasTerminalCondition)],
        ['Details', health.terminalConditionDetails],
        ['Disabilities or allergies?', formatBool(health.hasDisabilities)],
        ['Disability / Allergy details', health.disabilityDetails || health.allergies],
      ])}
    </table>
  </section>

  <section>
    <h2>Academic & employment history</h2>
    ${academicTable}
    <h3>Additional skills & competencies</h3>
    <p>${escapeHtml(payload.skillsSummary || '') || '&nbsp;'}</p>
    <h3>Employment history</h3>
    ${employmentTable}
  </section>

  <section>
    <h2>Compliance history</h2>
    <h3>Criminal / civil cases</h3>
    <table class="kv">
      ${renderTableRows([
        ['Any convictions or criminal matters?', formatBool(payload.criminalHistory?.hasRecord)],
      ])}
    </table>
    ${renderArrayTable(
      [
        { key: 'date', label: 'Date of conviction' },
        { key: 'nature', label: 'Nature of case' },
        { key: 'penalty', label: 'Penalty' },
      ],
      payload.criminalHistory?.entries || []
    )}
    <h3>Employment dismissals</h3>
    <table class="kv">
      ${renderTableRows([
        ['Ever dismissed for misconduct?', formatBool(payload.misconductHistory?.hasRecord)],
      ])}
    </table>
    ${renderArrayTable(
      [
        { key: 'date', label: 'Date' },
        { key: 'reason', label: 'Reason / Details' },
      ],
      payload.misconductHistory?.entries || []
    )}
  </section>

  <section>
    <h2>Personal referees</h2>
    ${refereeTable}
  </section>

  <section>
    <h2>Declarations</h2>
    <ul>
      <li>A) I hereby declare that the information given on this form is correct to the best of my knowledge and belief: <strong>${formatBool(payload.declarations?.statementA)}</strong></li>
      <li>B) I have no criminal convictions, whether current, pending or past which I have not declared: <strong>${formatBool(payload.declarations?.statementB)}</strong></li>
      <li>C) Any misrepresentation of facts may be treated as grounds for rejection from employment: <strong>${formatBool(payload.declarations?.statementC)}</strong></li>
      <li>D) I promise to co-operate with persons evaluating my qualifications and records: <strong>${formatBool(payload.declarations?.statementD)}</strong></li>
    </ul>
    <table class="kv">
      ${renderTableRows([
        ['Applicant name', payload.declarations?.applicantName],
        ['Signature', payload.declarations?.signature],
        ['Date', payload.declarations?.signedAt],
      ])}
    </table>
  </section>

  <section>
    <h2>Required documents checklist</h2>
    ${documentTable}
  </section>

  <section>
    <h2>Verification</h2>
    <table class="kv">
      ${renderTableRows([
        ['Name of person verifying', payload.verification?.verifiedBy],
        ['Signature', payload.verification?.signature],
        ['Date', payload.verification?.verifiedAt],
        ['Remarks', payload.verification?.notes],
      ])}
    </table>
  </section>

  <footer>
    Generated ${escapeHtml(generatedAt)}
  </footer>
</body>
</html>`;

  return html;
}

export { DRIVER_DOCUMENTS };
