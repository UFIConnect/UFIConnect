export function createVaultTransport(client, getAccessToken) {
  const token = getAccessToken();
  const config = () => {
    if (!token || getAccessToken() !== token) throw new Error('Your account session changed. Reopen Vault after signing in.');
    return { headers: { Authorization: `Bearer ${token}` } };
  };
  return {
    get: async () => (await client.get('/vault/storage', config())).data,
    put: async body => (await client.put('/vault/storage', body, config())).data,
  };
}
