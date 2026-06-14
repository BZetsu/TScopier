import { Input } from './Input'

interface MtCompanyServerPickerProps {
  platform?: 'MT4' | 'MT5'
  value: string
  onChange: (value: string) => void
  label?: string
  hint?: string
  required?: boolean
}

/** MT5 server hostname entry (FxSocket — enter server name manually). */
export function MtCompanyServerPicker({
  value,
  onChange,
  label,
  hint,
  required,
}: MtCompanyServerPickerProps) {
  return (
    <Input
      label={label}
      hint={hint}
      value={value}
      onChange={event => onChange(event.target.value)}
      required={required}
    />
  )
}
