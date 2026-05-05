import { useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar collapsed={collapsed} />
      <Topbar onMenuToggle={() => setCollapsed(c => !c)} />
      <main className={`transition-all duration-300 ${collapsed ? 'ml-16' : 'ml-56'} mt-12 min-h-[calc(100vh-48px)]`}>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
