import {
  listExtensions,
  getExtensionById,
  getExtensionByExtensionId,
  listExtensionCategories,
  zListExtensionsData,
  zGetExtensionByIdData,
  zGetExtensionByExtensionIdData,
  zListExtensionCategoriesData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';

const tools = defineToolGroup({
  listExtensions: {
    id: 'list_extensions',
    description: 'Read-only. List available extensions with optional filters.',
    schema: zListExtensionsData,
    sdkFn: listExtensions,
    params: 'query' as const,
    compact: true,
  },
  getExtension: {
    id: 'get_extension',
    description: 'Read-only. Get extension details by internal id.',
    schema: zGetExtensionByIdData,
    sdkFn: getExtensionById,
    pathKeys: ['id'],
  },
  getExtensionByExtensionId: {
    id: 'get_extension_by_extension_id',
    description: 'Read-only. Get extension details by extension_id.',
    schema: zGetExtensionByExtensionIdData,
    sdkFn: getExtensionByExtensionId,
    pathKeys: ['extension_id'],
  },
  getExtensionCategories: {
    id: 'get_extension_categories',
    description: 'Read-only. List extension categories.',
    schema: zListExtensionCategoriesData,
    sdkFn: listExtensionCategories,
    params: 'query' as const,
  },
});

export const listExtensionsTool = tools.listExtensions;
export const getExtensionTool = tools.getExtension;
export const getExtensionByExtensionIdTool = tools.getExtensionByExtensionId;
export const getExtensionCategoriesTool = tools.getExtensionCategories;
export const extensionTools = tools;
