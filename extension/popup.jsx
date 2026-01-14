import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import { ExtensionPopup } from '../src/components/ExtensionPopup';
import '../src/index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <Toaster position="top-center" />
    <ExtensionPopup />
  </React.StrictMode>
);
