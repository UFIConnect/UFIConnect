// Exported so other pages (e.g. Landing's pricing section) can render the
// same names/prices without retyping them somewhere they'd drift out of sync.
export const TIERS = [
  {
    tier: 'pro',
    name: 'Pro',
    price: '19.94',
    tagline: 'For individuals',
    icon: 'Pro',
  },
  {
    tier: 'business',
    name: 'Business',
    price: '199.94',
    tagline: 'For recruiting companies',
    icon: 'Biz',
    note: 'One person: $199.94/month. Teams of 2 or more: $19.94 per person/month. Includes a workspace for recruiting and career sources.',
  },
];
