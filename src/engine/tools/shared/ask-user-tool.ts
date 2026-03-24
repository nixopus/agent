import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const askUserTool = createTool({
  id: 'ask_user',
  description:
    'Signal that you need information from the user before proceeding. ' +
    'After calling this tool, relay the question to the user as plain text ' +
    'in your response and stop. Do not take further actions until the user replies.',
  inputSchema: z.object({
    question: z.string().describe('The question to present to the user'),
  }),
  outputSchema: z.object({
    status: z.literal('awaiting_reply'),
    question: z.string(),
  }),
  execute: async ({ question }) => {
    return { status: 'awaiting_reply' as const, question };
  },
});
