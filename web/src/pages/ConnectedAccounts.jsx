import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import client from '../api/client';

export default function ConnectedAccounts() {
  const [platforms, setPlatforms] = useState([]);
  const [connected, setConnected] = useState({});
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([
      client.get('/social/platforms'),
      client.get('/profile'),
    ]).then(([pRes, uRes]) => {
      setPlatforms(Object.entries(pRes.data.platforms || {}));
      setConnected(uRes.data.socialAccounts || {});
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function handleConnect(platform) {
    // Open the platform's real login page in a new tab
    const p = platforms.find(([key]) => key === platform)?.[1];
    if (p?.loginUrl) window.open(p.loginUrl, '_blank', 'noopener,noreferrer');
    // Also record the connection locally (mock token)
    try {
      await client.post('/social/connect', {
        platform,
        platformUserId: `demo_${platform}_user`,
        accessToken: 'mock_token',
      });
      setConnected((prev) => ({ ...prev, [platform]: { platform } }));
    } catch (err) { console.error(err); }
  }

  async function handleDisconnect(platform) {
    try {
      await client.delete(`/social/connect/${platform}`);
      setConnected((prev) => { const n = { ...prev }; delete n[platform]; return n; });
    } catch (err) { console.error(err); }
  }

  return (
    <Layout>
      {/* Back */}
      <div style={{ marginBottom: 20 }}>
        <Link to="/profile">
          <button className="btn btn-ghost btn-sm">← Back to Profile</button>
        </Link>
      </div>

      <div className="page-header">
        <h1 className="page-title">Connected Accounts</h1>
        <p className="page-subtitle">Link your social profiles to personalise your feed and import content.</p>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : (
        <div className="platform-list">
          {platforms.map(([key, p]) => {
            const isConnected = !!connected[key];
            return (
              <div key={key} className="platform-item">
                <div className="platform-dot" style={{ background: p.color }} />
                <div className="platform-info">
                  <div className="platform-name">{p.name}</div>
                  <div className="platform-desc">{p.description}</div>
                  {p.note && (
                    <div style={{ fontSize: '.72rem', color: 'var(--warning)', marginTop: 3 }}>
                      ℹ️ {p.note}
                    </div>
                  )}
                </div>
                {isConnected ? (
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <span style={{ fontSize:'.78rem', color:'var(--success)', fontWeight:600 }}>✓ Connected</span>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDisconnect(key)}>
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => handleConnect(key)}
                    style={{ borderColor: p.color, color: p.color }}
                  >
                    Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
