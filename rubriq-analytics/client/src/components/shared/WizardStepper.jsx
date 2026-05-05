import { Check } from 'lucide-react';

export default function WizardStepper({ steps, currentStep }) {
  return (
    <div className="flex items-center">
      {steps.map((step, i) => {
        const stepNum = i + 1;
        const completed = stepNum < currentStep;
        const active = stepNum === currentStep;
        return (
          <div key={i} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                completed ? 'bg-green-500 text-white' : active ? 'bg-primary-600 text-white ring-4 ring-primary-100' : 'bg-gray-100 text-gray-400'
              }`}>
                {completed ? <Check size={14} /> : stepNum}
              </div>
              <span className={`text-xs mt-1.5 font-medium whitespace-nowrap ${active ? 'text-primary-600' : completed ? 'text-green-600' : 'text-gray-400'}`}>
                {step}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 mb-4 ${completed ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
