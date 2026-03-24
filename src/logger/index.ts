import pino from 'pino';
import { config } from '../config';

const devTransport: pino.TransportSingleOptions = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
    messageFormat: '{msg}',
    singleLine: false,
  },
};

export function createLogger(module: string): pino.Logger {
  return pino({
    name: module,
    level: config.logLevel,
    ...(config.isDevelopment && { transport: devTransport }),
  });
}
