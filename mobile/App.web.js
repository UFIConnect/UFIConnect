import React, { useEffect } from 'react';
import Website from './current-site/Website';
import { reportClientError } from '../web/src/api/errorReporting';

export default function App() {
  useEffect(() => {
    const onError = () => reportClientError({ code: 'script_error' });
    const onRejection = () => reportClientError({ code: 'unhandled_rejection' });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return <Website nativePlatform={null} initialSession={null} />;
}
