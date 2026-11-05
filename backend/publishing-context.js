'use strict';

function accountIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of ['id', 'label', 'handle']) {
    const text = typeof value[key] === 'string' || typeof value[key] === 'number' ? String(value[key]).trim() : '';
    if (text && text.length <= 512 && !/[\x00-\x1f\x7f]/.test(text)) result[key] = text;
  }
  return result.id && result.label ? result : null;
}

function successfulDestinations(platform, rows = []) {
  const successful = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    let targets = row?.targets;
    if (typeof targets === 'string') { try { targets = JSON.parse(targets); } catch { continue; } }
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      if (target?.platform !== platform || target.status !== 'posted' || typeof target.destinationId !== 'string' || !target.destinationId) continue;
      const timestamp = Date.parse(row.created_at || row.createdAt || '');
      successful.push({ destinationId: target.destinationId, ...(Number.isFinite(timestamp) ? { at: new Date(timestamp).toISOString() } : {}) });
    }
  }
  return successful;
}

function publishingContext(platform, schema, rows = []) {
  // Recommendations can only point to a destination verified in this request.
  // A previous receipt never grants access or supplies privacy/audience consent.
  const choices = new Map((Array.isArray(schema?.destinations) ? schema.destinations : [])
    .filter(choice => typeof choice?.id === 'string' || typeof choice?.id === 'number')
    .map(choice => [String(choice.id), choice]));
  const previous = successfulDestinations(platform, rows).find(item => choices.has(item.destinationId));
  const destinationId = previous?.destinationId || (choices.size === 1 ? choices.keys().next().value : null);
  const context = { recommendation: previous ? 'last_successful_destination' : destinationId ? 'only_verified_destination' : null };
  const account = accountIdentity(schema?.account);
  if (account) context.account = account;
  if (previous) context.usage = { source: 'uficonnect-publishing-history', ...(previous.at ? { lastSuccessfulAt: previous.at } : {}) };
  // Keep adapter fields intact; suggestions deliberately contain only an ID.
  const { account: _account, suggestedValues: _suggestions, context: _context, ...publicSchema } = schema || {};
  return { ...publicSchema, suggestedValues: destinationId ? { destinationId } : {}, context };
}

module.exports = { publishingContext };
