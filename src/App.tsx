import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import JsonToolPage from './pages/JsonToolPage';
import McpManagerPage from './pages/McpManagerPage';
import SkillsManagerPage from './pages/SkillsManagerPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/json" replace />} />
          <Route path="/json" element={<JsonToolPage />} />
          <Route path="/skills" element={<SkillsManagerPage />} />
          <Route path="/mcp" element={<McpManagerPage />} />
          {/* 旧路由兼容：重定向到统一编辑器 */}
          <Route path="/jsonl" element={<Navigate to="/json" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
