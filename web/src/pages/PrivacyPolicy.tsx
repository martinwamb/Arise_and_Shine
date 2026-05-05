import React from 'react';

const LAST_UPDATED = '5 May 2026';
const COMPANY = 'Arise & Shine Transporters';
const DOMAIN = 'ariseandshinetransporters.com';
const CONTACT_EMAIL = 'admin@ariseandshinetransporters.com';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='mb-8'>
      <h2 className='text-xl font-semibold text-slate-800 mb-3 pb-2 border-b border-slate-200'>{title}</h2>
      <div className='space-y-3 text-slate-600 leading-relaxed'>{children}</div>
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='mt-4'>
      <h3 className='font-medium text-slate-700 mb-2'>{title}</h3>
      <div className='space-y-2'>{children}</div>
    </div>
  );
}

export default function PrivacyPolicy() {
  return (
    <div className='min-h-screen bg-slate-50 py-10 px-4'>
      <div className='max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12'>

        {/* Header */}
        <div className='mb-10 text-center'>
          <div className='inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-900 text-white text-2xl mb-4'>🔒</div>
          <h1 className='text-3xl font-bold text-slate-900'>Privacy Policy</h1>
          <p className='text-slate-500 mt-2'>{COMPANY}</p>
          <p className='text-sm text-slate-400 mt-1'>Last updated: {LAST_UPDATED}</p>
        </div>

        <p className='text-slate-600 mb-8 leading-relaxed'>
          This Privacy Policy explains how <strong>{COMPANY}</strong> ("we", "our", or "us") collects, uses, stores, and protects
          information when you use our logistics management platform — available as a web application at{' '}
          <strong>{DOMAIN}</strong> and as a mobile application ("Arise &amp; Shine") on Android and iOS devices.
          By using our services, you agree to the practices described in this policy.
        </p>

        <Section title='1. Who This Policy Applies To'>
          <p>This policy applies to all users of the Arise &amp; Shine platform, including:</p>
          <ul className='list-disc pl-5 space-y-1 mt-2'>
            <li><strong>Administrators</strong> — staff who manage the platform, fleet, and users</li>
            <li><strong>Operations staff</strong> — personnel handling orders, dispatch, and stock</li>
            <li><strong>Drivers</strong> — vehicle operators registered on the platform</li>
            <li><strong>Fuel monitors</strong> — staff capturing fuel consumption records</li>
            <li><strong>Customers</strong> — individuals or businesses placing delivery orders</li>
          </ul>
        </Section>

        <Section title='2. Information We Collect'>

          <Sub title='2.1 Account & Identity Information'>
            <p>When you register or are added to the platform, we collect:</p>
            <ul className='list-disc pl-5 space-y-1'>
              <li>Full name</li>
              <li>Email address</li>
              <li>Phone number</li>
              <li>Role and access level</li>
              <li>Encrypted password (we never store plain-text passwords)</li>
              <li>Telegram Chat ID (optional, for notification delivery)</li>
            </ul>
          </Sub>

          <Sub title='2.2 Driver-Specific Information'>
            <p>For registered drivers, we additionally collect as part of the employment onboarding process:</p>
            <ul className='list-disc pl-5 space-y-1'>
              <li>National ID or passport number and scanned document image</li>
              <li>Profile photograph</li>
              <li>Date of birth and nationality</li>
              <li>Residential and postal address</li>
              <li>Marital status</li>
              <li>Next of kin details (name, relationship, phone number, address)</li>
              <li>Job position, payroll number, and preferred work location</li>
              <li>Assigned vehicle number</li>
            </ul>
          </Sub>

          <Sub title='2.3 Order & Payment Information'>
            <p>When orders are placed, we collect:</p>
            <ul className='list-disc pl-5 space-y-1'>
              <li>Delivery site name and location</li>
              <li>Order quantity and pricing details</li>
              <li>Payment method (e.g. M-Pesa, bank transfer)</li>
              <li>Payment reference number provided by you</li>
              <li>Payment status and confirmation notes</li>
            </ul>
            <p className='text-sm text-slate-500 mt-2'>
              We do <strong>not</strong> process payments directly. All payments are made externally (e.g. via M-Pesa paybill
              or bank transfer) and you provide us only with the reference number for manual verification.
            </p>
          </Sub>

          <Sub title='2.4 Operational Records'>
            <ul className='list-disc pl-5 space-y-1'>
              <li>Fuel log entries: litres dispensed, odometer reading, cost, pump receipt photo, date/time</li>
              <li>Cost/expense records: type, amount, description, supporting receipt image</li>
              <li>Stock movements: material type, quantity, transaction reason</li>
              <li>Trip assignments: truck plate, driver, order reference, delivery status</li>
            </ul>
          </Sub>

          <Sub title='2.5 Vehicle Location & Telemetry Data'>
            <p>
              We collect real-time vehicle tracking data from our fleet management partners (Protrack 365 and Cartrack).
              This includes:
            </p>
            <ul className='list-disc pl-5 space-y-1'>
              <li>GPS coordinates (latitude and longitude)</li>
              <li>Vehicle speed and heading</li>
              <li>Engine idle time and ignition status</li>
              <li>Trip distance and duration</li>
              <li>Approximate address (derived via reverse geocoding from OpenStreetMap)</li>
            </ul>
            <p className='text-sm text-slate-500 mt-2'>
              This data is tied to vehicles and drivers, not to customers. The mobile app itself does
              <strong> not</strong> access your device's GPS — all location data comes from hardware devices
              installed in our vehicles.
            </p>
          </Sub>

          <Sub title='2.6 Images & Photos'>
            <p>The mobile app requests access to your device camera and photo library for the following specific purposes:</p>
            <ul className='list-disc pl-5 space-y-1'>
              <li><strong>Camera:</strong> Capturing fuel pump receipt photos, odometer readings, driver profile photos, and national ID/passport scans</li>
              <li><strong>Photo library:</strong> Selecting existing photos from your device for the same purposes above</li>
            </ul>
            <p className='text-sm text-slate-500 mt-2'>
              Photos are uploaded securely to our server and stored in association with the relevant record
              (fuel log, driver profile, or expense). We do not scan, analyse, or share your photos with
              third parties, except where AI-assisted receipt verification is used internally (see Section 4).
            </p>
          </Sub>

        </Section>

        <Section title='3. How We Use Your Information'>
          <ul className='list-disc pl-5 space-y-2'>
            <li>To authenticate you and provide access to the platform based on your role</li>
            <li>To manage and track delivery orders, assignments, and payments</li>
            <li>To monitor fleet performance, vehicle locations, and driver activity</li>
            <li>To detect and prevent duplicate fuel log entries or expense fraud</li>
            <li>To send operational notifications (order updates, payment confirmations, alerts) via email or Telegram</li>
            <li>To generate operational reports (earnings, stock levels, trip logs, speeding alerts)</li>
            <li>To process driver employment onboarding and maintain employment records</li>
            <li>To comply with our internal compliance and audit obligations</li>
          </ul>
        </Section>

        <Section title='4. Artificial Intelligence Features'>
          <p>Our platform uses AI-powered features for operational intelligence. These include:</p>
          <ul className='list-disc pl-5 space-y-2 mt-2'>
            <li><strong>Receipt image verification:</strong> Uploaded fuel and cost receipt photos may be analysed by an AI vision model to detect discrepancies between recorded values and the receipt image</li>
            <li><strong>Telemetry anomaly detection:</strong> Vehicle GPS and speed data is processed by an AI model to identify unusual patterns such as route deviations, unexpected stops, or speeding incidents</li>
            <li><strong>Operations assistant:</strong> Administrators can interact with an AI chat assistant that has access to operational data including orders, costs, fleet status, and driver performance</li>
            <li><strong>Article generation:</strong> The platform auto-generates informational articles about the logistics industry</li>
          </ul>
          <p className='mt-3 text-sm text-slate-500'>
            AI processing may be performed by a locally hosted model or via a third-party provider
            (OpenAI-compatible API). Operational data shared with AI models is limited to what is
            necessary for the specific task and is not used to train external AI models.
          </p>
        </Section>

        <Section title='5. Third-Party Services'>
          <p>We use the following third-party services to operate our platform:</p>
          <div className='overflow-x-auto mt-3'>
            <table className='w-full text-sm border-collapse'>
              <thead>
                <tr className='bg-slate-50'>
                  <th className='text-left p-3 border border-slate-200 font-medium text-slate-700'>Service</th>
                  <th className='text-left p-3 border border-slate-200 font-medium text-slate-700'>Purpose</th>
                  <th className='text-left p-3 border border-slate-200 font-medium text-slate-700'>Data Shared</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Protrack 365', 'Vehicle GPS tracking', 'Vehicle IMEI identifiers'],
                  ['Cartrack', 'Vehicle GPS tracking', 'Vehicle account credentials'],
                  ['OpenStreetMap Nominatim', 'Reverse geocoding (coordinates → address)', 'GPS coordinates only'],
                  ['OpenAI / Local LLM', 'AI-assisted insights and receipt verification', 'Operational data, receipt images'],
                  ['Telegram Bot API', 'Optional notification delivery', 'Message content, chat ID'],
                  ['Let\'s Encrypt', 'SSL/TLS certificate issuance', 'Domain name only'],
                ].map(([svc, purpose, data]) => (
                  <tr key={svc} className='border-b border-slate-100'>
                    <td className='p-3 border border-slate-200 font-medium'>{svc}</td>
                    <td className='p-3 border border-slate-200'>{purpose}</td>
                    <td className='p-3 border border-slate-200 text-slate-500'>{data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className='mt-3 text-sm text-slate-500'>
            We do not sell your data to third parties and do not use your data for advertising purposes.
          </p>
        </Section>

        <Section title='6. Data Storage & Security'>
          <ul className='list-disc pl-5 space-y-2'>
            <li>All data is stored on our dedicated server hosted in the European Union (Hetzner, Finland)</li>
            <li>All data transmission between the app/website and our servers uses HTTPS/TLS encryption</li>
            <li>Passwords are hashed using bcrypt and are never stored or transmitted in plain text</li>
            <li>Authentication tokens on your mobile device are stored in your device's secure encrypted storage (Android Keystore / iOS Keychain)</li>
            <li>Uploaded images are stored on the server and accessible only to authorised users</li>
            <li>Access to data is restricted by role — each user can only access data appropriate to their role</li>
          </ul>
        </Section>

        <Section title='7. Data Retention'>
          <ul className='list-disc pl-5 space-y-2'>
            <li><strong>Vehicle telemetry data:</strong> Automatically deleted after 90 days</li>
            <li><strong>Password reset tokens:</strong> Expire after 60 minutes and are deleted automatically</li>
            <li><strong>Orders, costs, fuel logs, and stock records:</strong> Retained for operational and audit purposes indefinitely unless deletion is requested</li>
            <li><strong>Driver employment records:</strong> Retained for the duration of employment and as required by applicable Kenyan labour law</li>
            <li><strong>User accounts:</strong> Retained while the account is active; deactivated accounts are retained for audit trail purposes</li>
          </ul>
        </Section>

        <Section title='8. Your Rights'>
          <p>Subject to applicable law, you have the right to:</p>
          <ul className='list-disc pl-5 space-y-2 mt-2'>
            <li><strong>Access</strong> the personal information we hold about you</li>
            <li><strong>Correct</strong> inaccurate or incomplete personal information</li>
            <li><strong>Request deletion</strong> of your personal data (subject to legal and operational retention requirements)</li>
            <li><strong>Withdraw consent</strong> for optional data collection such as Telegram notifications</li>
            <li><strong>Object</strong> to processing of your data for specific purposes</li>
          </ul>
          <p className='mt-3'>
            To exercise any of these rights, contact us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className='text-blue-600 underline'>{CONTACT_EMAIL}</a>.
            We will respond within 30 days.
          </p>
        </Section>

        <Section title="9. Children's Privacy">
          <p>
            Our platform is designed for use by businesses and employed adults. We do not knowingly collect
            personal information from anyone under the age of 18. If you believe a minor has provided us
            with personal information, please contact us immediately.
          </p>
        </Section>

        <Section title='10. Changes to This Policy'>
          <p>
            We may update this Privacy Policy from time to time. When we do, we will update the "Last updated"
            date at the top of this page. For significant changes, we will notify administrators via email.
            Continued use of the platform after changes are posted constitutes acceptance of the updated policy.
          </p>
        </Section>

        <Section title='11. Contact Us'>
          <p>If you have any questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact us:</p>
          <div className='mt-3 bg-slate-50 rounded-xl p-4 space-y-1 text-sm'>
            <p><strong>{COMPANY}</strong></p>
            <p>Nairobi, Kenya</p>
            <p>Email: <a href={`mailto:${CONTACT_EMAIL}`} className='text-blue-600 underline'>{CONTACT_EMAIL}</a></p>
            <p>Website: <a href={`https://${DOMAIN}`} className='text-blue-600 underline'>{DOMAIN}</a></p>
          </div>
        </Section>

      </div>
    </div>
  );
}
