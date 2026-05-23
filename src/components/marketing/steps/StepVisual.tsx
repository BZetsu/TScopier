import type { LandingStepVisualId } from '../../../i18n/locales/landing/types'
import { StepConfigureVisual } from './StepConfigureVisual'
import { StepCopyVisual } from './StepCopyVisual'
import { StepTelegramVisual } from './StepTelegramVisual'

interface StepVisualProps {
  id: LandingStepVisualId
}

export function StepVisual({ id }: StepVisualProps) {
  switch (id) {
    case 'telegram':
      return <StepTelegramVisual />
    case 'configure':
      return <StepConfigureVisual />
    case 'copy':
      return <StepCopyVisual />
    default:
      return null
  }
}
