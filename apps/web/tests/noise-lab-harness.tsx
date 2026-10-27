// Development-only browser test page; not a production Rollup entry.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { NoiseSuppressionLab } from '../src/components/voice/NoiseSuppressionLab';
import '../src/index.css';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <NoiseSuppressionLab />
    </BrowserRouter>
  </StrictMode>,
);
