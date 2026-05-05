import { useState, useEffect } from 'react';
import { settingsAPI } from '../services/api';
import { PageLoader } from '../components/shared/LoadingSpinner';
import { Save, Settings as SettingsIcon } from 'lucide-react';

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    settingsAPI.get().then(res => setSettings(res.data)).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const flat = Object.values(settings).flat().map(s => ({ key: s.key, value: s.value }));
    try {
      await settingsAPI.update(flat);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  const updateSetting = (key, value) => {
    setSettings(prev => {
      const updated = { ...prev };
      for (const group of Object.keys(updated)) {
        updated[group] = updated[group].map(s => s.key === key ? { ...s, value } : s);
      }
      return updated;
    });
  };

  if (loading) return <PageLoader />;

  const groupLabels = { general: 'General', academic: 'Academic', uploads: 'File Uploads', notifications: 'Notifications', accreditation: 'Accreditation' };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Configure system-wide preferences</p>
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          <Save size={14} />{saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>

      {Object.entries(settings).map(([group, items]) => (
        <div key={group} className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-4 capitalize">{groupLabels[group] || group}</h3>
          <div className="space-y-4">
            {items.map(setting => (
              <div key={setting.key} className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700">{setting.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{setting.key}</p>
                </div>
                <div className="w-64">
                  <input
                    className="input text-sm"
                    type={setting.type === 'number' ? 'number' : 'text'}
                    value={setting.value}
                    onChange={e => updateSetting(setting.key, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
