import {
  getBackupSchedule,
  updateBackupSchedule,
  listMachineBackups,
  triggerMachineBackup,
  zGetBackupScheduleData,
  zUpdateBackupScheduleData,
  zListMachineBackupsData,
  zTriggerMachineBackupData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';

const tools = defineToolGroup({
  getBackupSchedule: {
    id: 'get_backup_schedule',
    description: 'Read-only. Get the current machine backup schedule configuration.',
    schema: zGetBackupScheduleData,
    sdkFn: getBackupSchedule,
    params: 'query' as const,
  },
  updateBackupSchedule: {
    id: 'update_backup_schedule',
    description: 'Mutating. Update the machine backup schedule. Configure frequency, retention, and timing.',
    schema: zUpdateBackupScheduleData,
    sdkFn: updateBackupSchedule,
  },
  listMachineBackups: {
    id: 'list_machine_backups',
    description: 'Read-only. List available machine backups with timestamps, sizes, and status.',
    schema: zListMachineBackupsData,
    sdkFn: listMachineBackups,
    params: 'query' as const,
    compact: true,
  },
  triggerMachineBackup: {
    id: 'trigger_machine_backup',
    description: 'Mutating. Trigger an immediate machine backup. Requires user approval.',
    schema: zTriggerMachineBackupData,
    sdkFn: triggerMachineBackup,
    requireApproval: true,
  },
});

export const getBackupScheduleTool = tools.getBackupSchedule;
export const updateBackupScheduleTool = tools.updateBackupSchedule;
export const listMachineBackupsTool = tools.listMachineBackups;
export const triggerMachineBackupTool = tools.triggerMachineBackup;
export const backupTools = tools;
