// The authenticated backend deletes the current account with DELETE /profile.
// It does not accept a password or require a request body. Never infer success
// from an HTTP status alone, and keep local credentials after a failed request.
async function deleteAccountWithSession({ client, apiBase, token, clearLocalSession }) {
  if (typeof token !== 'string' || !token) throw new Error('Sign in again before deleting your account.');
  const response = await client.delete(`${apiBase}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  if (response?.data?.deleted !== true) {
    throw new Error('The server did not confirm account deletion. Please try again or contact support@uficonnect.org.');
  }
  // Deletion revokes the account on the server. A device storage failure must
  // not turn confirmed deletion into an invitation to repeat the destructive call.
  let localCleared = false;
  try {
    await clearLocalSession();
    localCleared = true;
  } catch {
    // AuthContext has already removed the in-memory token and profile.
  }
  return { deleted: true, localCleared };
}

module.exports = { deleteAccountWithSession };
