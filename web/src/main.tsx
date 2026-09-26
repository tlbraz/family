import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/nunito';
import { App } from './App';
import { installBackTrap } from './back';
import { registerServiceWorker } from './share';
import './styles.css';

installBackTrap();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
