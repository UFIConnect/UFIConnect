import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import OfficeAccessDialog from './OfficeAccessDialog';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <OfficeAccessDialog />
    <App />
  </StrictMode>
);
