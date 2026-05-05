import { useState, useRef } from 'react';
import { Upload, File, X, CheckCircle } from 'lucide-react';

const ALLOWED_TYPES = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'webp', 'zip'];
const BLOCKED_TYPES = ['exe', 'bat', 'cmd', 'sh', 'php', 'js', 'html', 'msi'];

export default function FileUploadCard({ onFiles, multiple = true, accept, maxFiles = 10, excelOnly = false }) {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const inputRef = useRef();

  const allowedSet = excelOnly ? ['xlsx', 'xls', 'csv'] : ALLOWED_TYPES;
  const acceptStr = accept || (excelOnly ? '.xlsx,.xls,.csv' : allowedSet.map(e => `.${e}`).join(','));

  const validateFile = (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (BLOCKED_TYPES.includes(ext)) return `${ext} files are blocked for security reasons`;
    if (!allowedSet.includes(ext)) return `${ext} files are not supported`;
    if (file.size > 25 * 1024 * 1024) return 'File exceeds 25MB limit';
    return null;
  };

  const handleFiles = (newFiles) => {
    setError('');
    const valid = [];
    for (const f of newFiles) {
      const err = validateFile(f);
      if (err) { setError(err); continue; }
      valid.push(f);
    }
    const updated = multiple ? [...files, ...valid].slice(0, maxFiles) : valid.slice(0, 1);
    setFiles(updated);
    onFiles?.(updated);
  };

  const removeFile = (i) => {
    const updated = files.filter((_, idx) => idx !== i);
    setFiles(updated);
    onFiles?.(updated);
  };

  return (
    <div className="space-y-3">
      <div
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(Array.from(e.dataTransfer.files)); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
      >
        <input ref={inputRef} type="file" className="hidden" multiple={multiple} accept={acceptStr} onChange={e => handleFiles(Array.from(e.target.files))} />
        <Upload size={24} className="mx-auto mb-3 text-gray-400" />
        <p className="text-sm font-medium text-gray-700">Drop files here or click to browse</p>
        <p className="text-xs text-gray-400 mt-1">{excelOnly ? 'Excel / CSV files only' : 'PDF, Word, Excel, PPT, Images, ZIP'} · Max 25MB</p>
      </div>

      {error && <p className="text-xs text-red-600 flex items-center gap-1"><X size={12} />{error}</p>}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-green-50 border border-green-100 rounded-lg">
              <CheckCircle size={16} className="text-green-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{f.name}</p>
                <p className="text-xs text-gray-500">{(f.size / 1024).toFixed(0)} KB</p>
              </div>
              <button type="button" onClick={() => removeFile(i)} className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600 transition-colors">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
