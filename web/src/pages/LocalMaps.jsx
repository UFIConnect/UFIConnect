import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
// The Office's Live City map. Only the local website preview has this page; the
// public build leaves it and the Office code out (see App.jsx).
import CityMapPreview from '../../../office/src/CityMapPreview';

export default function LocalMaps() {
  return <Layout wide>
    <Helmet><title>Maps | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <header className="page-header">
      <h1 className="page-title">Maps</h1>
      <p className="page-subtitle">Local preview of the Live City: downtown, the towns and the beltway. Sample agents; nothing here is published.</p>
    </header>
    <CityMapPreview />
  </Layout>;
}
