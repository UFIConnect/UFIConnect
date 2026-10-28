'use strict';

const { isIP } = require('node:net');

function databaseConnectionOptions(connectionString, env = process.env, { role = 'primary' } = {}) {
  if (!['primary', 'backup'].includes(role)) throw new Error('Unknown database connection role.');
  const url = new URL(connectionString);
  const sslNegotiation = url.searchParams.getAll('sslnegotiation').at(-1);
  if (sslNegotiation !== undefined && !['postgres', 'direct'].includes(sslNegotiation)) {
    throw new Error('Unsupported PostgreSQL TLS negotiation mode.');
  }
  // pg connection-string SSL parameters can replace the explicit ssl object.
  // Remove them so URL query options cannot silently disable verification.
  // Its direct-negotiation parser also replaces the object with `true`; pass
  // that mode separately so the trusted CA and certificate identity survive.
  for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat', 'sslnegotiation']) url.searchParams.delete(key);
  const disabled = env.DATABASE_SSL_MODE === 'disable';
  if (disabled && env.NODE_ENV === 'production' && env.DATABASE_ALLOW_PLAINTEXT_INTERNAL !== 'true') {
    throw new Error('Disabling production database TLS requires DATABASE_ALLOW_PLAINTEXT_INTERNAL=true for a trusted private network.');
  }
  // Keep destination-specific trust separate from the existing feed backup.
  const ca = role === 'primary' ? env.DATABASE_PRIMARY_SSL_CA || env.DATABASE_SSL_CA : env.DATABASE_SSL_CA;
  const servername = role === 'primary' ? env.DATABASE_PRIMARY_SSL_SERVERNAME : undefined;
  if (servername) {
    const validDnsName = typeof servername === 'string' && servername.length <= 253 && !isIP(servername) && !/\s/.test(servername)
      && servername.includes('.') && servername.split('.').every(label =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
    if (!validDnsName) throw new Error('DATABASE_PRIMARY_SSL_SERVERNAME must be an exact DNS hostname.');
    // pg overrides TLS servername for DNS hosts, including a query-string host
    // override. Validate the effective host that its connection parser uses.
    const host = url.searchParams.getAll('host').at(-1) || decodeURIComponent(url.hostname);
    if (!isIP(host) && host.toLowerCase() !== servername.toLowerCase()) {
      throw new Error('The primary TLS hostname requires an IP connection URL or the same DNS hostname.');
    }
  }
  const ssl = disabled || (env.NODE_ENV !== 'production' && env.DATABASE_SSL_MODE !== 'verify-full')
    ? false
    : { rejectUnauthorized: true, ...(ca ? { ca: ca.replace(/\\n/g, '\n') } : {}), ...(servername ? { servername } : {}) };
  if (servername && !ssl) throw new Error('A primary TLS hostname requires verified TLS.');
  return { connectionString: url.toString(), ssl, ...(sslNegotiation !== undefined ? { sslnegotiation: sslNegotiation } : {}) };
}

module.exports = { databaseConnectionOptions };
