export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
  selfHosted: process.env.SELF_HOSTED === 'true' || false,

  port: parseInt(process.env.PORT || '9090', 10),
  host: process.env.HOST || '0.0.0.0',

  databaseUrl: process.env.DATABASE_URL || '',

  redisUrl: process.env.REDIS_URL || '',

  logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
  logName: process.env.LOG_NAME || 'Agent',

  observabilityEnabled: process.env.OBSERVABILITY_ENABLED !== 'false',
  
  authToken: process.env.AUTH_TOKEN || '',
  
  authServiceUrl: process.env.AUTH_SERVICE_URL || '',

  apiUrl: process.env.API_URL || '',
  apiKey: process.env.API_KEY || '',

  dashboardUrl: process.env.DASHBOARD_URL || '',

  agentModel: process.env.AGENT_MODEL || 'openrouter/anthropic/claude-sonnet-4',
  agentLightModel: process.env.AGENT_LIGHT_MODEL || 'openrouter/openai/gpt-4o-mini',
  agentMaxOutputTokens: parseInt(process.env.AGENT_MAX_OUTPUT_TOKENS || '4000', 10),
  agentMaxSteps: parseInt(process.env.AGENT_MAX_STEPS || '15', 10),

  allowedOrigin: process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map((origin) => origin.trim())
    : process.env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:3000', 'http://localhost:7443'],

  m2m: {
    clientId: process.env.M2M_CLIENT_ID || '',
    clientSecret: process.env.M2M_CLIENT_SECRET || '',
    tokenUrl: process.env.AUTH_TOKEN_URL || `${(process.env.AUTH_SERVICE_URL || '').replace(/\/$/, '')}/api/auth/oauth2/token`,
    jwksUrl: process.env.AUTH_JWKS_URL || `${(process.env.AUTH_SERVICE_URL || '').replace(/\/$/, '')}/api/auth/jwks`,
    issuer: process.env.AUTH_ISSUER || `${(process.env.AUTH_SERVICE_URL || '').replace(/\/$/, '')}/api/auth`,
    orgClaimKey: process.env.M2M_ORG_CLAIM_KEY || 'https://nixopus.com/org',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    authMaxRequests: parseInt(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || '10', 10),
  },
  observationalMemory: {
    messageTokens: parseInt(process.env.OM_MESSAGE_TOKENS || '30000', 10),
    observationTokens: parseInt(process.env.OM_OBSERVATION_TOKENS || '40000', 10),
    model: process.env.OM_MODEL || 'openrouter/google/gemini-2.5-flash',
  },

  s3: {
    bucket: process.env.S3_BUCKET || '',
    region: process.env.S3_REGION || 'us-east-1',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
    endpoint: process.env.S3_ENDPOINT || '',
  },

} as const;

