'use strict';

function databaseConnectionOptions(connectionString, env = process.env) {
  const url = new URL(connectionString);
  // pg connection-string SSL parameters can replace the explicit ssl object.
  // Remove them so URL query options cannot silently disable verification.
  for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
  const disabled = env.DATABASE_SSL_MODE === 'disable';
  if (disabled && env.NODE_ENV === 'production' && env.DATABASE_ALLOW_PLAINTEXT_INTERNAL !== 'true') {
    throw new Error('Disabling production database TLS requires DATABASE_ALLOW_PLAINTEXT_INTERNAL=true for a trusted private network.');
  }
  const ssl = disabled || (env.NODE_ENV !== 'production' && env.DATABASE_SSL_MODE !== 'verify-full')
    ? false
    : { rejectUnauthorized: true, ...(env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA.replace(/\\n/g, '\n') } : {}) };
  return { connectionString: url.toString(), ssl };
}

module.exports = { databaseConnectionOptions };
