'use strict';

const catalog = require('./business-industries.json');
const industries = new Map(catalog.map(({ id, name, description }) => [id, { id, name, description }]));
const businessRegistrationMessage = 'Business is a separate recruiting account. Sign out and choose Business on the public registration page to create a new account with a different email.';
const fault = (status, message) => Object.assign(new Error(message), { status });

// Existing paid members keep their account track. A cutoff on existing rows
// permits later verification of a genuinely paid, pre-policy Stripe checkout;
// it never makes an unpaid checkout or arbitrary Stripe metadata eligible.
const BUSINESS_ACCOUNT_SCHEMA = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT CHECK (account_type IN ('personal','business'))`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS business_industry_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS business_enrollment_cutoff TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS business_billing_review BOOLEAN NOT NULL DEFAULT false`,
  `UPDATE users SET account_type=CASE WHEN plan='business' THEN 'business' ELSE 'personal' END,
    business_enrollment_cutoff=NOW() WHERE account_type IS NULL`,
  `ALTER TABLE users ALTER COLUMN account_type SET DEFAULT 'personal', ALTER COLUMN account_type SET NOT NULL`,
];

function accountTypeOf(user) {
  // The fallback supports existing synthetic fixtures and old in-memory users.
  // A persisted explicit personal type is never promoted from a plan label.
  const explicit = user?.account_type || user?.accountType;
  return explicit ? (explicit === 'business' ? 'business' : 'personal') : user?.plan === 'business' ? 'business' : 'personal';
}

function registrationDetails(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fault(400, 'Enter your account details.');
  const accountType = input.accountType === undefined ? 'personal' : input.accountType;
  if (!['personal', 'business'].includes(accountType)) throw fault(400, 'Choose a personal or Business account.');
  if (accountType === 'personal') return { accountType, organization: '', industryId: '' };
  if (typeof input.organization !== 'string' || input.organization.trim().length < 2 || input.organization.trim().length > 120) {
    throw fault(400, 'Enter your recruiting organization’s name (2–120 characters).');
  }
  if (typeof input.businessIndustryId !== 'string' || !industries.has(input.businessIndustryId)) throw fault(400, 'Choose your organization’s industry.');
  return { accountType, organization: input.organization.trim(), industryId: input.businessIndustryId };
}

function businessAccountOptions() { return { industries: [...industries.values()] }; }

module.exports = { BUSINESS_ACCOUNT_SCHEMA, accountTypeOf, businessRegistrationMessage, registrationDetails, businessAccountOptions };
