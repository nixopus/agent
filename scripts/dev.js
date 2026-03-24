import { spawn, execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadEnv(path) {
  try {
    const content = readFileSync(path, 'utf-8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          if (!process.env[key]) process.env[key] = value;
        }
      }
    });
  } catch {
  }
}
loadEnv(join(__dirname, '..', '.env'));

async function loadSecrets() {
  try {
    const { initializeSecrets } = await import('../src/init-secrets.ts');
    await initializeSecrets();
  } catch (error) {
    console.warn('[Dev] ⚠ Warning: Failed to load secrets:', error.message);
  }
}

await loadSecrets();

const devPort = process.env.PORT || '9090';
process.env.PORT = devPort;

const mastraEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key !== 'PORT')
);
mastraEnv.PORT = devPort;

const secretManagerVars = [
  'SECRET_MANAGER_ENABLED',
  'SECRET_MANAGER_TYPE',
  'SECRET_MANAGER_PROJECT_ID',
  'SECRET_MANAGER_ENVIRONMENT',
  'SECRET_MANAGER_SECRET_PATH',
  'INFISICAL_URL',
  'INFISICAL_TOKEN',
];

secretManagerVars.forEach((key) => {
  if (process.env[key]) {
    mastraEnv[key] = process.env[key];
  }
});

if (!mastraEnv.DB_POOL_MAX) mastraEnv.DB_POOL_MAX = '2';
if (!mastraEnv.DB_POOL_MIN) mastraEnv.DB_POOL_MIN = '0';
if (!mastraEnv.DB_LISTENER_POOL_MAX) mastraEnv.DB_LISTENER_POOL_MAX = '1';


const mastraProcess = spawn('mastra', ['dev', '--dir', 'src/engine'], {
  stdio: 'inherit',
  shell: true,
  env: mastraEnv,
});

mastraProcess.on('error', (error) => {
  console.error('[Dev] Failed to start mastra dev:', error);
  process.exit(1);
});

mastraProcess.on('exit', (code) => {
  process.exit(code || 0);
});
