import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import JsonToolPage from './pages/JsonToolPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/json" replace />} />
          <Route path="/json" element={<JsonToolPage />} />
          {/* 旧路由兼容：重定向到统一编辑器 */}
          <Route path="/jsonl" element={<Navigate to="/json" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
