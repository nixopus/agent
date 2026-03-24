import { createLocalOrchestrator } from './local-orchestrator';

export * from './orchestrator';
export { createLocalOrchestrator } from './local-orchestrator';

let defaultOrchestrator: ReturnType<typeof createLocalOrchestrator> | null = null;

export function getDefaultOrchestrator() {
  if (!defaultOrchestrator) {
    defaultOrchestrator = createLocalOrchestrator();
  }
  return defaultOrchestrator;
}
