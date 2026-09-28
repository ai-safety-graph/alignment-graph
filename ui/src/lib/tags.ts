import {
  Anchor,
  Bot,
  ClipboardCheck,
  Compass,
  Hourglass,
  Landmark,
  Lock,
  MessageSquareWarning,
  Microscope,
  Scale,
  ShieldAlert,
  Tag,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// One icon per LLM classification tag. Keys must match TAXONOMY in
// src/aisafety_pipeline/taxonomy.py; unknown tags fall back to a generic icon.
// Icons render in currentColor so hue stays reserved for graph node roles.
const TAG_ICONS: Record<string, LucideIcon> = {
  'alignment and value specification': Compass,
  'interpretability and explainability': Microscope,
  'oversight and safety evaluation': ClipboardCheck,
  'adversarial robustness and security': ShieldAlert,
  'robustness and generalization': Anchor,
  'large language model safety': MessageSquareWarning,
  'agentic and multi-agent safety': Bot,
  'AI governance and policy': Landmark,
  'existential and long-term risk': Hourglass,
  'fairness and societal impact': Scale,
  'privacy and data protection': Lock,
}

export function tagIcon(tag: string): LucideIcon {
  return TAG_ICONS[tag] ?? Tag
}
