import React from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { publicAsset } from './publicAsset';

export default function AppWelcome() {
  return <div className="app-welcome">
    <Helmet><title>Welcome to UFIConnect</title></Helmet>
    <main className="app-welcome-main">
      <img className="app-welcome-logo" src={publicAsset('/uficonnect-mark.svg?v=blue-ufi-20261006')} width="80" height="80" alt="" />
      <h1>Welcome to UFIConnect</h1>
      <p>Your people, communities, and interests in one place.</p>
      <nav className="app-welcome-actions" aria-label="Get started">
        <Link className="app-welcome-primary" to="/login">Sign in</Link>
        <Link className="app-welcome-secondary" to="/register">Create account</Link>
      </nav>
      <nav className="app-welcome-policies" aria-label="Policies">
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/child-safety">Safety</Link>
      </nav>
    </main>
  </div>;
}
