// Diagram content is independent of layout and can later come from a coverage report.
// These are conceptual API families, not a per-language support certification.
export const REQUEST_FLOW = [
  {
    id: 'core', label: 'The core request', input: 'Request', output: 'Response',
    rows: [
      { label: 'OpenAI Chat', transport: 'HTTPS · JSON / SSE', target: 'Chat Completions' },
      { label: 'OpenAI Responses', transport: 'HTTPS · JSON / SSE', target: 'Responses API' },
      { label: 'Anthropic', transport: 'HTTPS · JSON / SSE', target: 'Messages API' },
      { label: 'Gemini', transport: 'HTTPS · JSON / SSE', target: 'Generate Content' },
    ],
  },
  {
    id: 'more', label: 'More request types', input: 'Typed inputs', output: 'Typed results',
    rows: [
      { label: 'Images & video', transport: 'Generation · jobs', target: 'Media' },
      { label: 'Live voice', transport: 'Realtime connection', target: 'Live events' },
      { label: 'Files & batches', transport: 'Uploads · background jobs', target: 'Job results' },
    ],
  },
];
