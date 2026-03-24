export function isDeployAgentStream(pathname: string): boolean {
  return pathname === '/api/agents/deploy-agent/stream' ||
    pathname.endsWith('/agents/deploy-agent/stream');
}

export function isAgentStreamEndpoint(pathname: string): boolean {
  return /\/agents\/[^/]+\/stream$/.test(pathname);
}
