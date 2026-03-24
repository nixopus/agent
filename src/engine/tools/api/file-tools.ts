import {
  listFiles,
  deleteDirectory,
  createDirectory,
  moveDirectory,
  copyDirectory,
  uploadFile,
  zListFilesData,
  zDeleteDirectoryData,
  zCreateDirectoryData,
  zMoveDirectoryData,
  zCopyDirectoryData,
  zUploadFileData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';

const tools = defineToolGroup({
  listFiles: {
    id: 'list_files',
    description: 'Read-only. List files for a project path/directory.',
    schema: zListFilesData,
    sdkFn: listFiles,
  },
  createDirectory: {
    id: 'create_directory',
    description: 'Mutating. Create a directory at the target path.',
    schema: zCreateDirectoryData,
    sdkFn: createDirectory,
  },
  moveDirectory: {
    id: 'move_directory',
    description: 'Mutating. Move a directory from source path to destination path.',
    schema: zMoveDirectoryData,
    sdkFn: moveDirectory,
  },
  copyDirectory: {
    id: 'copy_directory',
    description: 'Mutating. Copy a directory from source path to destination path.',
    schema: zCopyDirectoryData,
    sdkFn: copyDirectory,
  },
  uploadFile: {
    id: 'upload_file',
    description: 'Mutating. Upload a file to a target project path.',
    schema: zUploadFileData,
    sdkFn: uploadFile,
  },
  deleteDirectory: {
    id: 'delete_directory',
    description: 'Mutating and destructive. Delete a directory at the target path.',
    schema: zDeleteDirectoryData,
    sdkFn: deleteDirectory,
  },
});

export const listFilesTool = tools.listFiles;
export const createDirectoryTool = tools.createDirectory;
export const moveDirectoryTool = tools.moveDirectory;
export const copyDirectoryTool = tools.copyDirectory;
export const uploadFileTool = tools.uploadFile;
export const deleteDirectoryTool = tools.deleteDirectory;
export const fileTools = tools;
