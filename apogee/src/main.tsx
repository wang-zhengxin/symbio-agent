import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './font.css';

const officePage = /^#(?:overview|tasks|people|agents|layout|help|discovery|finance|conversations|settings|inbox)(?:\/|$)/;
if (window.location.pathname === '/' && officePage.test(window.location.hash)) {
  window.location.replace('/office' + window.location.hash);
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
