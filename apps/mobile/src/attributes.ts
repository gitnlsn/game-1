import type { AttributeKey } from '@eleven-deep/engine';

/** Attributes in the groups the player screen shows them in. */
export const ATTRIBUTE_GROUPS: { title: string; keys: AttributeKey[] }[] = [
  { title: 'Technical', keys: ['finishing', 'passing', 'dribbling', 'crossing', 'tackling', 'heading'] },
  { title: 'Mental', keys: ['vision', 'composure', 'positioning', 'workRate'] },
  { title: 'Physical', keys: ['pace', 'strength', 'stamina'] },
  { title: 'Goalkeeping', keys: ['reflexes', 'handling', 'distribution'] },
];

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  finishing: 'Finishing', passing: 'Passing', dribbling: 'Dribbling', crossing: 'Crossing',
  tackling: 'Tackling', heading: 'Heading', vision: 'Vision', composure: 'Composure',
  positioning: 'Positioning', workRate: 'Work rate', pace: 'Pace', strength: 'Strength',
  stamina: 'Stamina', reflexes: 'Reflexes', handling: 'Handling', distribution: 'Distribution',
};
