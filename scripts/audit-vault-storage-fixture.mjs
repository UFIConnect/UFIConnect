// Synthetic ciphertext only. Backend SQL, validation and authentication have
// their own PostgreSQL/route tests; this fixture supports browser workflows.
export async function installAuditVaultStorage(page, account) {
  const records = new Map();
  const accountId = () => typeof account === 'function' ? account() : account;
  const fixture = {
    reset() { records.clear(); },
    snapshot() { return structuredClone(records.get(accountId())); },
    seed(record) { records.set(accountId(), { accountId: accountId(), revision: 1, record }); },
  };
  await page.route('**/vault/storage', async route => {
    const request = route.request(), id = accountId();
    const headers = { 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Origin': request.headers().origin || '*',
      'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (!request.headers().authorization) return route.fulfill({ status: 401, headers, json: { message: 'Synthetic authentication required' } });
    let current = records.get(id) || { accountId: id, revision: 0, record: null };
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      if (body.revision !== current.revision) return route.fulfill({ status: 409, headers, json: { message: 'Synthetic conflict' } });
      current = { accountId: id, revision: current.revision + 1, record: body.record };
      records.set(id, current);
    }
    return route.fulfill({ headers, json: current });
  });
  return fixture;
}
