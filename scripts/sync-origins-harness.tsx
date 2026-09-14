// Test-only entry point; never imported by the production app.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FinanceProvider, useFinance } from '../src/context/FinanceContext';
import { AppContent } from '../src/App';
import '../src/index.css';
function Probe() { (window as any).finance = useFinance(); return <AppContent />; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><FinanceProvider><Probe /></FinanceProvider></React.StrictMode>);
