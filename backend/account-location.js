'use strict';
const directory = require('./local-account-directory.json');

// Curated discovery order, not measured city adoption. Restrict availability
// suggestions to reviewed markets; existing OAuth metadata remains decisive.
const POPULAR_MARKETS = new Set(['US', 'CA', 'GB', 'AU', 'NZ', 'IE', 'DE', 'FR', 'ES', 'IT', 'JP', 'SG', 'BR', 'MX', 'IN']);
const POPULAR_PLATFORMS = ['youtube', 'instagram', 'facebook', 'reddit', 'spotify', 'airbnb', 'booking'];
const CAREER_PLATFORMS = ['indeed', 'linkedin', 'glassdoor'];
const COUNTRY_CAREER_PLATFORMS = { US: ['ziprecruiter', 'usajobs'], GB: ['reed'], AU: ['seek'], NZ: ['seek'], IN: ['naukri'] };
const normalized = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function matchesArea(area, location) {
  if (!location.available || location.mode === 'off' || area.country !== String(location.country || '').toUpperCase()) return false;
  const region = normalized(location.region);
  if (region && !area.regions.some(value => normalized(value) === region)) return false;
  if (area.cities.length) return area.cities.some(value => normalized(value) === normalized(location.city));
  // A statewide source requires a matching region; country alone cannot
  // make California reporting look local to every US member.
  return Boolean(region && area.regions.some(value => normalized(value) === region));
}

function localSourceRecord(source, area) {
  return { ...source, loginUrl: null, connectionMode: 'external', configured: false, connected: false,
    authorizationSupported: false, available: false, localSource: true,
    forceComingSoon: false, commandCenterOnly: false, requiresMembership: false, locked: false,
    note: 'Read or use this local source on its official website. Account sync and publishing are unavailable.',
    crossPost: { supported: false }, ownContent: { supported: false }, feed: { home: false, following: null },
    localArea: { label: area.label, scope: area.scope, country: area.country },
  };
}

function locationAccounts({ platforms = {}, location = {}, careerOnly = false }) {
  const localSources = directory.areas.filter(area => matchesArea(area, location))
    .sort((a, b) => Number(a.scope === 'region') - Number(b.scope === 'region'))
    .flatMap(area => area.sources.filter(source => !careerOnly || source.category === 'career')
      .map(source => localSourceRecord(source, area)));
  const country = String(location.country || '').toUpperCase();
  const candidates = location.available && location.mode !== 'off' && POPULAR_MARKETS.has(country)
    ? careerOnly ? [...CAREER_PLATFORMS, ...(COUNTRY_CAREER_PLATFORMS[country] || [])] : POPULAR_PLATFORMS : [];
  const platformIds = candidates.filter(id => Object.hasOwn(platforms, id)
    && (!careerOnly || id === 'linkedin' || platforms[id]?.category === 'career'));
  return { platformIds, localSources, basis: 'local_sources_and_platforms', careerOnly };
}

module.exports = { locationAccounts, matchesArea };
