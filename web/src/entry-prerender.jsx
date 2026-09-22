import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './contexts/AuthContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import GuestFeed from './pages/GuestFeed';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import ChildSafety from './pages/ChildSafety';
import ForgotPassword from './pages/ForgotPassword';
import SearchGuide from './pages/SearchGuide';
import NotFound from './pages/NotFound';

const pages={landing:Landing,login:Login,register:Register,global:GuestFeed,privacy:PrivacyPolicy,terms:TermsOfService,childSafety:ChildSafety,forgotPassword:ForgotPassword,search:SearchGuide,notFound:NotFound};
export function renderPage(path,page) {
  const Page=pages[page];
  if(!Page)throw new Error(`Unknown prerender page ${page}`);
  const base=import.meta.env.BASE_URL.replace(/\/$/,'');
  return renderToString(<HelmetProvider><StaticRouter basename={base||'/'} location={`${base}${path}`}><AuthProvider><Page /></AuthProvider></StaticRouter></HelmetProvider>);
}
