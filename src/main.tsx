import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { DocProvider } from './ui/store';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DocProvider>
      <App />
    </DocProvider>
  </StrictMode>,
);
