// Account identity survives cancellation. A paid plan is a separate entitlement.
// Legacy profiles remain readable while the server backfills existing accounts.
export function isBusinessAccount(profile) {
  if (profile?.accountType != null) return profile.accountType === 'business';
  return profile?.plan === 'business' || profile?.personalPlan === 'business' || profile?.businessTeam?.active === true;
}

export function membershipTiersForAccount(profile) {
  return isBusinessAccount(profile) ? ['business'] : ['pro'];
}
