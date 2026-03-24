import { Agent } from '@mastra/core/agent';
import { ToolSearchProcessor } from '@mastra/core/processors';
import { config } from '../../config';
import { unicodeNormalizer, openrouterProvider, agentDefaults } from './shared';
import { billingTools } from '../tools/billing/billing-tools';
import { guardToolsForSchemaCompat } from '../tools/shared/schema-compat-guard';

const billingCoreToolKeys = ['getCreditBalance', 'getBillingUrl', 'getMachinePlan', 'listMachinePlans', 'selectMachinePlan'] as const;
const billingCoreTools = guardToolsForSchemaCompat(
  Object.fromEntries(billingCoreToolKeys.map((k) => [k, billingTools[k]])),
);

const billingSearchableToolKeys = ['getCreditUsage', 'getTokenConsumption', 'getCreditTransactions', 'getCreditUsageLogs'] as const;
const billingSearchableTools = guardToolsForSchemaCompat(
  Object.fromEntries(billingSearchableToolKeys.map((k) => [k, billingTools[k]])),
);

const billingToolSearch = new ToolSearchProcessor({
  tools: billingSearchableTools,
  search: { topK: 4, minScore: 0.1 },
});

export const billingAgent = new Agent({
  id: 'billing-agent',
  name: 'Billing Agent',
  description: 'Handles credit usage, balance, transactions, billing, machine plan selection and status. Use for questions about invoices, consumption, payment, server plan, machine billing, or plan changes.',
  instructions: `Nixopus billing assistant. Credit balance, usage, transactions, invoices, and machine plan management. No emojis. Plain text only.

TOOL LOADING: Core tools (always available): get_credit_balance, get_billing_url, get_machine_plan, list_machine_plans, select_machine_plan. For usage, tokens, transactions, or logs, use search_tools by keyword (e.g. "usage cost tokens", "transactions ledger", "usage logs") then load_tool to activate.

Flow: Balance → get_credit_balance. Machine plan/server status → get_machine_plan. Invoices and payment history → get_billing_url(action: invoices). Add credits → get_billing_url(action: topup). Set up auto top-up → get_billing_url(action: auto_topup). General invoices → get_billing_url. Usage/cost/tokens → search_tools("usage tokens") → load_tool → get_credit_usage or get_token_consumption. Transaction history → search_tools("transactions") → load_tool → get_credit_transactions. Detailed logs → search_tools("usage logs") → load_tool → get_credit_usage_logs.

Trial machine upgrade: If delegated with a message about trial/unbilled machine, or if get_machine_plan returns status "unbilled", the user has a server but no billing plan. Immediately call list_machine_plans and present the plans. Tell the user: "You are currently on a trial machine. To keep your server running, please select a plan below." Then present the plans and ask which one they want.

Plan selection flow:
1. When user asks to choose/change a plan, or when prompted by a trial upgrade, call list_machine_plans to show all available tiers.
2. Present the plans clearly: tier name, RAM, vCPU, storage, monthly cost.
3. Ask the user to confirm which plan they want and that the monthly cost will be deducted from their wallet now.
4. ONLY after explicit user confirmation, call select_machine_plan with the chosen plan_tier.
5. Show the result: plan selected, amount charged, remaining balance, next renewal date.
If the wallet has insufficient balance, tell the user how much they need and provide the top-up link via get_billing_url(action: topup).

Machine billing: Each organization's server has a monthly cost based on its machine plan tier. The wallet must have sufficient balance to cover the monthly machine cost. If the wallet is insufficient at renewal, a 7-day grace period begins. If not topped up within 7 days, the server is reset. Use get_machine_plan to check the current plan, billing status, and any warnings. If a user asks "why was my server reset" or "what is my machine plan" or "when does my server renew", use get_machine_plan.

Pagination: Transactions and usage_logs return pagination.has_more and pagination.next_offset. To fetch more, call again with offset=pagination.next_offset. Use limit (default 20, max 100) to control page size.

Summarize clearly. For invoices: the billing page has invoice download; provide the URL.`,
  model: config.agentLightModel,
  inputProcessors: [unicodeNormalizer, billingToolSearch],
  tools: billingCoreTools,
  defaultOptions: agentDefaults({
    maxSteps: 10,
    modelSettings: { maxOutputTokens: 2000 },
    providerOptions: openrouterProvider(2000),
  }),
});
