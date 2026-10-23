import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './monacoSetup';
import { bootstrapTheme } from './hooks/useThemeSettings';

// 渲染前应用主题，避免闪烁
bootstrapTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
