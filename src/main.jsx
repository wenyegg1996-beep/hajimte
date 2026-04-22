import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { AppShell } from './legacy/AppLegacy.jsx';
import { backendApi } from './services/backendApi.js';
import { UtilsLib, safeStringify } from './legacy/utils.js';
import './styles/index.css';

window.fbOps = backendApi;
window.UtilsLib = UtilsLib;
window.safeStringify = safeStringify;

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <AppShell />
    </React.StrictMode>
);

export default App;
