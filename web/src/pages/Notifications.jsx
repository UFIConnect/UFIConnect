import Layout from '../components/Layout';
import NotificationInbox from '../components/NotificationInbox';

export default function Notifications() {
  return <Layout><div className="notifications-page"><div className="page-header"><h1 className="page-title">Notifications</h1></div><NotificationInbox /></div></Layout>;
}
