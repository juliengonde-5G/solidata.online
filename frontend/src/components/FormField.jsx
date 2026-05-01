import { useId } from 'react';

/**
 * FormField — champ de formulaire normalisé (label + input + erreur + hint).
 * Centralise l'a11y (label associé, aria-invalid, aria-describedby) et
 * supprime le boilerplate dupliqué dans 40+ pages.
 *
 * Props :
 *  - label : libellé visible (obligatoire)
 *  - type  : 'text' | 'email' | 'password' | 'number' | 'date' | 'tel' | 'url' | 'textarea' | 'select'
 *  - name, value, onChange : props natives contrôlées
 *  - error : message d'erreur (string) ou false/null
 *  - hint  : aide contextuelle
 *  - required, disabled, readOnly, placeholder, autoComplete
 *  - options : pour type='select', tableau [{value, label}]
 *  - rows : pour type='textarea'
 *  - min, max, step : pour type='number' / 'date'
 *  - className : classes additionnelles sur le wrapper
 */
export default function FormField({
  label,
  type = 'text',
  name,
  value,
  onChange,
  error,
  hint,
  required = false,
  disabled = false,
  readOnly = false,
  placeholder,
  autoComplete,
  options,
  rows = 3,
  min,
  max,
  step,
  className = '',
  inputClassName = '',
}) {
  const reactId = useId();
  const id = `${name || 'field'}-${reactId}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const baseInput = `input-modern w-full ${error ? 'border-red-400 focus:ring-red-400' : ''} ${inputClassName}`;
  const commonProps = {
    id,
    name,
    value: value ?? '',
    onChange,
    disabled,
    readOnly,
    placeholder,
    autoComplete,
    required,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy,
    className: baseInput,
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
        </label>
      )}

      {type === 'textarea' ? (
        <textarea {...commonProps} rows={rows} />
      ) : type === 'select' ? (
        <select {...commonProps}>
          {placeholder && <option value="">{placeholder}</option>}
          {(options || []).map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <input {...commonProps} type={type} min={min} max={max} step={step} />
      )}

      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
