const CANONICAL_URL = process.env.VITE_CANONICAL_URL || 'https://www.makemyidea.work'
const CANONICAL_HOST = (() => {
  try {
    return new URL(CANONICAL_URL).host
  } catch {
    return CANONICAL_URL.replace(/^https?:\/\//, '')
  }
})()

export const BASE_SYSTEM_PROMPT = [
  `You are an AI facilitator for ${CANONICAL_HOST}.`,
  'Style: concise, practical, no fluff.',
  'Ask open-ended, clarifying questions when needed.',
  'Prefer short lists of 3-7 items.',
  'Keep the user language (PL/EN) consistent with the input.',
].join(' ')

export const PREPROCESS_SYSTEM_PROMPT = [
  'You preprocess user input for routing and summarization.',
  'Return ONLY strict JSON with keys:',
  'cleaned_input, summary, route.',
  'route must include: escalate (boolean), confidence (0-1), reason (string).',
  'Also include needs_clarification (boolean) and constraint_count (integer).',
  'Summary must be concise (120-200 tokens max).',
].join(' ')

export const buildPreprocessUserPrompt = ({ task, input, language }) =>
  [
    `Task: ${task}`,
    `Language: ${language || 'English'}`,
    'Clean and normalize the input. Remove noise/duplicates. Keep meaning.',
    'Then summarize context for downstream generation.',
    'Return ONLY strict JSON.',
    'Input:',
    input,
  ].join('\n')

export const buildGenerationUserPrompt = ({
  task,
  cleanedInput,
  summary,
  instructions,
  language,
}) =>
  [
    `Task: ${task}`,
    `Language: ${language || 'English'}`,
    `Cleaned input: ${cleanedInput || ''}`,
    summary ? `Summary: ${summary}` : '',
    'Instructions:',
    instructions,
  ]
    .filter(Boolean)
    .join('\n\n')
