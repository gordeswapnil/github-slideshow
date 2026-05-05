export default function KPICard({ title, value, subtitle, icon: Icon, color = 'blue', trend, small = false }) {
  const colorMap = {
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600', value: 'text-blue-700' },
    green: { bg: 'bg-green-50', icon: 'text-green-600', value: 'text-green-700' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-600', value: 'text-amber-700' },
    red: { bg: 'bg-red-50', icon: 'text-red-600', value: 'text-red-700' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600', value: 'text-purple-700' },
    gray: { bg: 'bg-gray-50', icon: 'text-gray-500', value: 'text-gray-700' },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{title}</p>
        {Icon && (
          <div className={`w-8 h-8 ${c.bg} rounded-lg flex items-center justify-center`}>
            <Icon size={16} className={c.icon} />
          </div>
        )}
      </div>
      <div>
        <p className={`${small ? 'text-xl' : 'text-2xl'} font-bold text-gray-900`}>{value}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {trend && (
        <p className={`text-xs font-medium ${trend.positive ? 'text-green-600' : 'text-red-600'}`}>
          {trend.positive ? '↑' : '↓'} {trend.label}
        </p>
      )}
    </div>
  );
}
