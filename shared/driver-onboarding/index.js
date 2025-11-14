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
    owner: null,
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
      employeeUserId: null,
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
      validationStatus: null,
      flagMessage: null,
      lastUploadedAt: null,
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
      validationStatus: item.validationStatus || null,
      flagMessage: item.flagMessage || null,
      lastUploadedAt: item.lastUploadedAt || null,
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

function safeParse(value){
  try{
    return JSON.parse(value);
  }catch{
    return null;
  }
}

function normaliseSignaturePayload(raw){
  if(!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if(!trimmed.startsWith('{')) return null;
  const parsed = safeParse(trimmed);
  if(!parsed || !Array.isArray(parsed.strokes)) return null;
  const width = Number(parsed.width) > 0 ? Math.min(Number(parsed.width), 1024) : 320;
  const height = Number(parsed.height) > 0 ? Math.min(Number(parsed.height), 512) : 120;
  const strokes = parsed.strokes
    .map((stroke) => (Array.isArray(stroke.points) ? stroke.points.map((pt) => ({ x: Number(pt.x) || 0, y: Number(pt.y) || 0 })) : []))
    .filter((points) => points.length > 1);
  if(!strokes.length) return null;
  return { width, height, strokes };
}

function renderSignatureMarkup(raw){
  const parsed = normaliseSignaturePayload(raw);
  if(!parsed){
    return raw ? escapeHtml(raw) : '<span class="muted">Not signed</span>';
  }
  const paths = parsed.strokes
    .map((points) => {
      const segments = points.map((pt, index) => `${index === 0 ? 'M' : 'L'}${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`);
      return `<path d="${segments.join(' ')}" fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join('');
  return `<div class="signature-box"><svg viewBox="0 0 ${parsed.width} ${parsed.height}" role="img" aria-label="Handwritten signature">${paths}</svg></div>`;
}

export function renderDriverOnboardingHtml(form, options={}){
  const payload = form || createEmptyDriverOnboardingForm();
  const brand = options.brand || 'Arise & Shine Transporters';
  const driverLabel = options.driverLabel || payload.personalDetails?.surname || payload.driverId || 'Driver';
  const generatedAt = options.generatedAt || new Date().toLocaleString();
  const health = payload.healthDisclosure || {};
  const address = payload.residentialAddress || {};
  const home = payload.homeAddress || {};
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
      { key: 'status', label: 'AI status' },
      { key: 'remarks', label: 'Remarks' },
      { key: 'issues', label: 'AI feedback' },
    ],
    documents.map((doc) => ({
      label: doc.label,
      provided: formatBool(doc.provided),
      status: doc.validationStatus
        ? doc.validationStatus === 'verified'
          ? 'Verified'
          : doc.validationStatus === 'flagged'
            ? 'Needs resubmission'
            : 'Pending review'
        : doc.provided
          ? 'Awaiting AI check'
          : 'Not uploaded',
      remarks: doc.remarks || '',
      issues: doc.flagMessage || '',
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
  .signature-box { min-height: 80px; border: 1px dashed #cbd5f5; border-radius: 8px; padding: 8px; background: #fff; }
  .signature-box svg { width: 100%; height: auto; max-height: 160px; }
  .muted { color: #94a3b8; font-style: italic; }
  .declaration-list { padding-left: 18px; }
  .declaration-list li { margin-bottom: 6px; line-height: 1.4; }
</style>
</head>
<body>
  <header>
    <div class="badge">${escapeHtml(payload.status || 'draft')}</div>
    <h1>${escapeHtml(brand)} &mdash; Driver Registration Form</h1>
    <p>Driver: ${escapeHtml(`${personal.surname || ''} ${personal.otherNames || ''}`.trim() || driverLabel)} &bull; ID: ${escapeHtml(payload.driverId || personal.idNumber || 'N/A')}</p>
  </header>

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
    <h2>Declarations & signature</h2>
    <p>I hereby declare that:</p>
    <ol class="declaration-list">
      <li>(a) the information in this form is correct and filled to the best of my knowledge.</li>
      <li>(b) I have no criminal convictions, whether current, pending or past, which I have not declared under the relevant section.</li>
      <li>(c) any misrepresentation of facts may be treated as grounds for rejection from employment, disciplinary proceedings, and criminal charges being preferred against me.</li>
      <li>(d) I will cooperate with the persons evaluating my qualifications and/or records in case more information is required when contacting referees, former employers, institutions, or government agencies.</li>
    </ol>
    <table class="kv">
      ${renderTableRows([
        ['Statement A agreed?', formatBool(payload.declarations?.statementA)],
        ['Statement B agreed?', formatBool(payload.declarations?.statementB)],
        ['Statement C agreed?', formatBool(payload.declarations?.statementC)],
        ['Statement D agreed?', formatBool(payload.declarations?.statementD)],
        ['Applicant name', payload.declarations?.applicantName],
        ['Date signed', payload.declarations?.signedAt],
      ])}
      <tr>
        <th>Signature</th>
        <td>${renderSignatureMarkup(payload.declarations?.signature)}</td>
      </tr>
    </table>
  </section>

  <section>
    <h2>Required documents checklist</h2>
    ${documentTable}
  </section>

  <footer>
    Generated ${escapeHtml(generatedAt)}
  </footer>
</body>
</html>`;

  return html;
}

function normaliseText(value){
  return typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value || '').trim();
}

export function summarizeDriverOnboardingGaps(form){
  const payload = form || createEmptyDriverOnboardingForm();
  const personal = payload.personalDetails || {};
  const spouse = payload.spouse || {};
  const related = payload.relatedEmployeeDisclosure || {};
  const health = payload.healthDisclosure || {};
  const criminal = payload.criminalHistory || {};
  const misconduct = payload.misconductHistory || {};
  const nextOfKin = Array.isArray(payload.nextOfKin) ? payload.nextOfKin : [];
  const referees = Array.isArray(payload.referees) ? payload.referees : [];
  const documents = Array.isArray(payload.documentsChecklist) ? payload.documentsChecklist : [];
  const summary = {
    isComplete: true,
    missingFields: [],
    missingDocuments: [],
    steps: [],
    completionPercent: 0,
  };

  const requireFields = (fields, accumulator, summaryRef) => {
    fields.forEach(({ label, value }) => {
      if(!normaliseText(value)){
        accumulator.push(label);
        if(summaryRef && !summaryRef.missingFields.includes(label)){
          summaryRef.missingFields.push(label);
        }
      }
    });
  };

  const steps = [];

  const personalMissing = [];
  requireFields(
    [
      { label: 'Surname', value: personal.surname },
      { label: 'Other names', value: personal.otherNames },
      { label: 'Date of birth', value: personal.dateOfBirth },
      { label: 'Nationality', value: personal.nationality },
      { label: 'Mobile number', value: personal.mobileNumber },
      { label: 'Email address', value: personal.emailAddress },
      { label: 'National ID / Passport', value: personal.idNumber },
      { label: 'KRA PIN', value: personal.pinNumber },
    ],
    personalMissing,
    summary
  );
  if(normaliseText(personal.maritalStatus).toLowerCase() === 'married'){
    requireFields(
      [
        { label: 'Spouse name', value: spouse.name },
        { label: 'Spouse ID / Passport', value: spouse.idNumber },
        { label: 'Spouse mobile number', value: spouse.mobileNumber },
      ],
      personalMissing,
      summary
    );
  }
  steps.push({ id: 'personal', title: 'Personal details', missing: personalMissing, complete: personalMissing.length === 0 });

  const contactMissing = [];
  nextOfKin.slice(0, 1).forEach((kin, index) => {
    requireFields(
      [
        { label: `Next of kin ${index + 1} name`, value: kin?.name },
        { label: `Next of kin ${index + 1} relationship`, value: kin?.relationship },
        { label: `Next of kin ${index + 1} phone`, value: kin?.phone },
      ],
      contactMissing,
      summary
    );
  });
  if(related.hasRelation === true){
    requireFields(
      [
        { label: 'Related employee name', value: related.personName || related.employeeUserId },
        { label: 'Related employee position', value: related.position },
      ],
      contactMissing,
      summary
    );
  }else if(related.hasRelation !== false){
    contactMissing.push('Confirm relation to Arise & Shine employee');
    summary.missingFields.push('Confirm relation to Arise & Shine employee');
  }
  steps.push({ id: 'contact', title: 'Residence & contacts', missing: contactMissing, complete: contactMissing.length === 0 });

  const healthMissing = [];
  if(health.hasTerminalCondition === true && !normaliseText(health.terminalConditionDetails)){
    healthMissing.push('Terminal condition details');
    summary.missingFields.push('Terminal condition details');
  }else if(health.hasTerminalCondition !== false){
    healthMissing.push('Confirm terminal condition status');
    summary.missingFields.push('Confirm terminal condition status');
  }
  if(health.hasDisabilities === true && !normaliseText(health.disabilityDetails)){
    healthMissing.push('Disability / allergy details');
    summary.missingFields.push('Disability / allergy details');
  }else if(health.hasDisabilities !== false){
    healthMissing.push('Confirm disability status');
    summary.missingFields.push('Confirm disability status');
  }
  steps.push({ id: 'health', title: 'Health declaration', missing: healthMissing, complete: healthMissing.length === 0 });

  const complianceMissing = [];
  if(criminal.hasRecord === true){
    if(!Array.isArray(criminal.entries) || !criminal.entries.length || !normaliseText(criminal.entries[0]?.nature)){
      complianceMissing.push('Criminal case details');
      summary.missingFields.push('Criminal case details');
    }
  }else if(criminal.hasRecord !== false){
    complianceMissing.push('Confirm criminal case status');
    summary.missingFields.push('Confirm criminal case status');
  }
  if(misconduct.hasRecord === true){
    if(!Array.isArray(misconduct.entries) || !misconduct.entries.length || !normaliseText(misconduct.entries[0]?.reason)){
      complianceMissing.push('Dismissal details');
      summary.missingFields.push('Dismissal details');
    }
  }else if(misconduct.hasRecord !== false){
    complianceMissing.push('Confirm dismissal status');
    summary.missingFields.push('Confirm dismissal status');
  }
  steps.push({ id: 'compliance', title: 'Compliance history', missing: complianceMissing, complete: complianceMissing.length === 0 });

  const refereeMissing = [];
  referees.slice(0, 2).forEach((ref, index) => {
    requireFields(
      [
        { label: `Referee ${index + 1} name`, value: ref?.name },
        { label: `Referee ${index + 1} phone`, value: ref?.phone },
        { label: `Referee ${index + 1} relationship`, value: ref?.relationship },
      ],
      refereeMissing,
      summary
    );
  });
  steps.push({ id: 'referees', title: 'Referees', missing: refereeMissing, complete: refereeMissing.length === 0 });

  const declarationMissing = [];
  ['statementA', 'statementB', 'statementC', 'statementD'].forEach((statementKey, index) => {
    if(payload.declarations?.[statementKey] !== true){
      const label = `Declaration ${String.fromCharCode(65 + index)}`;
      declarationMissing.push(label);
      summary.missingFields.push(label);
    }
  });
  if(!normaliseText(payload.declarations?.applicantName)){
    declarationMissing.push('Applicant name');
    summary.missingFields.push('Applicant name');
  }
  if(!normaliseText(payload.declarations?.signature)){
    declarationMissing.push('Signature');
    summary.missingFields.push('Signature');
  }
  steps.push({ id: 'declaration', title: 'Declarations', missing: declarationMissing, complete: declarationMissing.length === 0 });

  const documentsMissing = documents.filter((doc) => !doc?.provided || !doc?.attachmentPath).map((doc) => doc?.label || doc?.code || 'Document');
  summary.missingDocuments = documentsMissing;
  if(documentsMissing.length){
    documentsMissing.forEach((label) => {
      if(!summary.missingFields.includes(label)){
        summary.missingFields.push(label);
      }
    });
  }
  steps.push({ id: 'documents', title: 'Documents', missing: documentsMissing, complete: documentsMissing.length === 0 });

  const completeCount = steps.filter((step) => step.complete).length;
  summary.steps = steps;
  summary.completionPercent = Math.round((completeCount / steps.length) * 100);
  summary.isComplete = summary.missingFields.length === 0 && summary.missingDocuments.length === 0;
  return summary;
}

export { DRIVER_DOCUMENTS };
