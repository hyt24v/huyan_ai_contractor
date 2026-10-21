import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import JsonEditorPage from './pages/JsonEditorPage';
import JsonlEditorPage from './pages/JsonlEditorPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/json" replace />} />
          <Route path="/json" element={<JsonEditorPage />} />
          <Route path="/jsonl" element={<JsonlEditorPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
