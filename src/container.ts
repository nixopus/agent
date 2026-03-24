import { DIContainer } from 'rsdi';
import { getDb } from './db/index';
import { config as defaultConfig } from './config';
import {
  getCacheStoreFactory,
  initCacheStoreFactory,
  type CacheStoreFactory,
} from './cache';

export type AppConfig = typeof defaultConfig;
export type DbInstance = ReturnType<typeof getDb>;

function buildContainer(cfg: AppConfig) {
  return new DIContainer()
    .add('config', () => cfg)
    .add('db', ({ config }) => getDb(config.databaseUrl))
    .add('cacheFactory', () => getCacheStoreFactory());
}

export type AppContainer = ReturnType<typeof buildContainer>;

let _container: AppContainer | null = null;

export function initContainer(cfg: AppConfig = defaultConfig): AppContainer {
  _container = buildContainer(cfg);
  return _container;
}

export function getContainer(): AppContainer {
  if (!_container) _container = buildContainer(defaultConfig);
  return _container;
}

export function resetContainer(): void {
  _container = null;
}
