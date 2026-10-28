import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import JsonToolPage from './pages/JsonToolPage';
import MarkdownPage from './pages/MarkdownPage';
import McpManagerPage from './pages/McpManagerPage';
import SkillsManagerPage from './pages/SkillsManagerPage';
import ProfilesPage from './pages/ProfilesPage';
import ProvidersPage from './pages/ProvidersPage';
import PromptsPage from './pages/PromptsPage';
import RulesPage from './pages/RulesPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/json" replace />} />
          <Route path="/json" element={<JsonToolPage />} />
          <Route path="/markdown" element={<MarkdownPage />} />
          <Route path="/skills" element={<SkillsManagerPage />} />
          <Route path="/mcp" element={<McpManagerPage />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
          {/* 旧路由兼容：重定向到统一编辑器 */}
          <Route path="/jsonl" element={<Navigate to="/json" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
