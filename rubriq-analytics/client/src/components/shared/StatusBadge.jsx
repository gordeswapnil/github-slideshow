const variants = {
  SUBMITTED: 'bg-blue-50 text-blue-700 border-blue-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  COMPLETED: 'bg-green-50 text-green-700 border-green-200',
  EVALUATED: 'bg-green-50 text-green-700 border-green-200',
  LATE: 'bg-orange-50 text-orange-700 border-orange-200',
  MISSING: 'bg-red-50 text-red-700 border-red-200',
  ACTIVE: 'bg-green-50 text-green-700 border-green-200',
  INACTIVE: 'bg-gray-50 text-gray-600 border-gray-200',
  PLANNED: 'bg-blue-50 text-blue-700 border-blue-200',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 border-amber-200',
  REVIEWED: 'bg-purple-50 text-purple-700 border-purple-200',
  DRAFT: 'bg-gray-50 text-gray-600 border-gray-200',
  GENERATED: 'bg-green-50 text-green-700 border-green-200',
  Excellent: 'bg-green-50 text-green-700 border-green-200',
  Good: 'bg-blue-50 text-blue-700 border-blue-200',
  Satisfactory: 'bg-amber-50 text-amber-700 border-amber-200',
  'Needs Improvement': 'bg-red-50 text-red-700 border-red-200',
  HIGH: 'bg-green-50 text-green-700 border-green-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW: 'bg-red-50 text-red-700 border-red-200',
  UNMAPPED: 'bg-gray-50 text-gray-500 border-gray-200',
  COMPLETE: 'bg-green-50 text-green-700 border-green-200',
  PUBLISHED: 'bg-green-50 text-green-700 border-green-200',
};

const labels = {
  IN_PROGRESS: 'In Progress',
  'Needs Improvement': 'Needs Improvement',
};

export default function StatusBadge({ status, size = 'sm' }) {
  const className = variants[status] || 'bg-gray-50 text-gray-600 border-gray-200';
  const label = labels[status] || status;
  const sizeClass = size === 'xs' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1';
  return (
    <span className={`inline-flex items-center ${sizeClass} rounded-full font-medium border ${className}`}>
      {label}
    </span>
  );
}
