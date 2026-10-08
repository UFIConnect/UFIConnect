import Layout from '../components/Layout';
import { CrossPostSection } from './CommandCenter';
export default function CareerPublishing() {
  return <Layout><div className="page-header"><h1 className="page-title">Career posting</h1><p className="page-subtitle">Prepare your hiring update, sign in at a career site, and review its posting tools.</p></div><CrossPostSection initialCategory="career" /></Layout>;
}
