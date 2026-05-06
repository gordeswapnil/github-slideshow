import { Sparkles, FileText, Upload, CheckCircle } from 'lucide-react';

const STEPS = [
  { icon: Upload, title: 'Upload Syllabus', desc: 'Upload any PDF, Word, Excel, or scanned image of your course syllabus — no fixed format required.' },
  { icon: Sparkles, title: 'AI Extracts Data', desc: 'Claude AI reads your document and identifies Program, Course, COs, POs, CO-PO mapping, Bloom\'s levels, and Rubric criteria.' },
  { icon: FileText, title: 'Review & Edit', desc: 'Preview all extracted data. Edit any field inline. Confidence indicators highlight fields that need your attention.' },
  { icon: CheckCircle, title: 'Import in One Click', desc: 'Confirm and all master records are created automatically — Institution, Courses, COs, POs, Rubric Templates — in seconds.' },
];

export default function AIImport() {
  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900">AI Syllabus Import</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload your course syllabus and let AI create all master records automatically</p>
        </div>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">Coming in Phase 2b</span>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={i} className="card p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-primary-600" />
                </div>
                <span className="text-xs font-bold text-gray-400">Step {i + 1}</span>
              </div>
              <h3 className="text-sm font-semibold text-gray-800">{step.title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{step.desc}</p>
            </div>
          );
        })}
      </div>

      {/* What gets imported */}
      <div className="card p-6">
        <h3 className="font-semibold text-gray-800 mb-4">What gets imported from your syllabus</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            'University / College / Department',
            'Program name, code, level & duration',
            'Course name, code, credits & semester',
            'Course Outcomes (COs) with Bloom\'s level',
            'Program Outcomes (POs) and PSOs',
            'CO-PO Mapping with strength (1/2/3)',
            'Rubric criteria with performance levels',
            'Assessment types & weightage config',
            'Attainment threshold settings',
          ].map(item => (
            <div key={item} className="flex items-center gap-2 text-sm text-gray-600">
              <CheckCircle size={14} className="text-green-500 shrink-0" />
              {item}
            </div>
          ))}
        </div>
      </div>

      {/* Supported formats */}
      <div className="card p-6">
        <h3 className="font-semibold text-gray-800 mb-3">Supported document formats</h3>
        <div className="flex flex-wrap gap-2">
          {['PDF', 'Word (.docx)', 'Excel (.xlsx)', 'Scanned Image (JPG/PNG)', 'Any format — AI figures it out'].map(f => (
            <span key={f} className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 font-medium">{f}</span>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">No fixed template required. The AI reads any standard university syllabus format.</p>
      </div>

      {/* Coming soon CTA */}
      <div className="card p-8 text-center" style={{ background: 'linear-gradient(135deg, #f0f4ff, #faf5ff)' }}>
        <Sparkles size={32} className="text-primary-400 mx-auto mb-3" />
        <h3 className="font-semibold text-gray-800 mb-1">This feature is being built now</h3>
        <p className="text-sm text-gray-500">AI Import will be available in Phase 2b. Meanwhile, you can add master data manually from Academic Setup and Programs &amp; Courses pages.</p>
      </div>
    </div>
  );
}
