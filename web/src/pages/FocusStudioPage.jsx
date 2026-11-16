import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import FocusStudio from '../../../office/src/FocusStudio';
import Layout from '../components/Layout';
import PublicOverviewLayout from './PublicOverviewLayout';

export default function FocusStudioPage({ prerendered = false }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const Frame = prerendered ? PublicOverviewLayout : Layout;

  return <Frame wide>
    <Helmet>
      <title>Focus Studio | UFIConnect</title>
      <meta name="description" content="Check your location, record routes, and set location-based Focus rules on your device." />
    </Helmet>
    {ready ? <FocusStudio active initialSection="tracking" allowViewBackground={false} /> : <section className="focus-studio">
      <h1>Focus Studio</h1>
      <p>Check your location, record routes, and set location-based Focus rules on your device.</p>
    </section>}
  </Frame>;
}
