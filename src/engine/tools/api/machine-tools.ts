import { z } from 'zod';
import {
  getMachineLifecycleStatus,
  getMachineSystemStats,
  executeACommandOnTheHostMachine,
  restartMachine,
  pauseMachine,
  resumeMachine,
  getMachineMetrics,
  getMachineMetricsSummary,
  getMachineEvents,
  zGetMachineLifecycleStatusData,
  zGetMachineSystemStatsData,
  zExecuteACommandOnTheHostMachineData,
  zRestartMachineData,
  zPauseMachineData,
  zResumeMachineData,
  zGetMachineMetricsData,
  zGetMachineMetricsSummaryData,
  zGetMachineEventsData,
} from '@nixopus/api-client';
import { defineToolGroup } from './tool-factory';
import { getClient } from './shared';

function sdkCall<T>(
  ctx: unknown,
  fn: (opts: any) => Promise<T>,
  opts: Record<string, unknown> = {},
): Promise<T> {
  return fn({ client: getClient(ctx), ...opts });
}

const tools = defineToolGroup({
  getMachineStats: {
    id: 'get_machine_stats',
    description:
      'Get a full system stats snapshot from the host machine: CPU usage (overall and per-core), ' +
      'RAM usage and total, disk usage per mount, network interface stats, load averages, uptime, ' +
      'kernel version, and architecture. Use this as the first step when diagnosing server-level issues ' +
      'like high memory usage, disk space exhaustion, or CPU saturation.',
    schema: zGetMachineSystemStatsData,
    sdkFn: getMachineSystemStats,
    outputSchema: z.object({
      os_type: z.string().optional(),
      hostname: z.string().optional(),
      cpu_info: z.string().optional(),
      cpu_cores: z.number().optional(),
      cpu: z.object({
        overall: z.number(),
        per_core: z.array(z.object({ core_id: z.number(), usage: z.number() })),
      }).optional(),
      memory: z.object({
        used: z.number(),
        total: z.number(),
        percentage: z.number(),
        rawInfo: z.string(),
      }).optional(),
      load: z.object({
        oneMin: z.number(),
        fiveMin: z.number(),
        fifteenMin: z.number(),
        uptime: z.string(),
      }).optional(),
      disk: z.object({
        total: z.number(),
        used: z.number(),
        available: z.number(),
        percentage: z.number(),
        mountPoint: z.string(),
        allMounts: z.array(z.object({
          filesystem: z.string(),
          size: z.string(),
          used: z.string(),
          avail: z.string(),
          capacity: z.string(),
          mountPoint: z.string(),
        })),
      }).optional(),
      kernel_version: z.string().optional(),
      architecture: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async (_input: any, ctx: unknown) => {
      try {
        return await sdkCall(ctx, getMachineSystemStats);
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  hostExec: {
    id: 'host_exec',
    description:
      'Run a shell command directly on the host machine via SSH. Use this for deep server-level ' +
      'diagnostics that go beyond the stats snapshot: checking top processes by memory ' +
      '(ps aux --sort=-%mem | head -20), reading system logs (dmesg | tail -50, journalctl -u docker --since "10 minutes ago"), ' +
      'checking Docker daemon status (systemctl status docker), inspecting disk usage breakdown ' +
      '(du -sh /var/lib/docker/*), checking open ports (ss -tlnp), or verifying DNS resolution ' +
      '(dig example.com). Returns stdout, stderr, and exit code separately.',
    schema: zExecuteACommandOnTheHostMachineData,
    sdkFn: executeACommandOnTheHostMachine,
    outputSchema: z.object({
      stdout: z.string(),
      stderr: z.string(),
      exit_code: z.number(),
      error: z.string().optional(),
    }),
    execute: async ({ command }: { command: string }, ctx: unknown) => {
      try {
        return await sdkCall(ctx, executeACommandOnTheHostMachine, { body: { command } });
      } catch (err: unknown) {
        return { stdout: '', stderr: '', exit_code: -1, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  getMachineLifecycleStatus: {
    id: 'get_machine_lifecycle_status',
    description:
      'Get the lifecycle state of the provisioned machine instance: whether it is active, ' +
      'its current state (Running, Paused, etc.), PID, and uptime in seconds. ' +
      'Use this before restart/pause/resume to confirm the current state.',
    schema: zGetMachineLifecycleStatusData,
    sdkFn: getMachineLifecycleStatus,
    outputSchema: z.object({
      data: z.object({
        active: z.boolean().optional(),
        state: z.string().optional(),
        pid: z.number().optional(),
        uptime_sec: z.number().optional(),
      }).optional(),
      status: z.string().optional(),
      message: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async (_input: any, ctx: unknown) => {
      try {
        return await sdkCall(ctx, getMachineLifecycleStatus);
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  restartMachine: {
    id: 'restart_machine',
    description:
      'Restart the provisioned machine instance. This will briefly interrupt all running services. ' +
      'Requires user approval before execution.',
    schema: zRestartMachineData,
    sdkFn: restartMachine,
    requireApproval: true,
    outputSchema: z.object({
      status: z.string().optional(),
      message: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async (_input: any, ctx: unknown) => {
      try {
        return await sdkCall(ctx, restartMachine);
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  pauseMachine: {
    id: 'pause_machine',
    description:
      'Pause the provisioned machine instance. The machine will stop processing but retain its state. ' +
      'Use resume_machine to bring it back. Requires user approval before execution.',
    schema: zPauseMachineData,
    sdkFn: pauseMachine,
    requireApproval: true,
    outputSchema: z.object({
      status: z.string().optional(),
      message: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async (_input: any, ctx: unknown) => {
      try {
        return await sdkCall(ctx, pauseMachine);
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  resumeMachine: {
    id: 'resume_machine',
    description:
      'Resume a paused machine instance. The machine will continue from where it was paused. ' +
      'Only works when the machine is in a Paused state. Requires user approval before execution.',
    schema: zResumeMachineData,
    sdkFn: resumeMachine,
    requireApproval: true,
    outputSchema: z.object({
      status: z.string().optional(),
      message: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async (_input: any, ctx: unknown) => {
      try {
        return await sdkCall(ctx, resumeMachine);
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  getMachineMetrics: {
    id: 'get_machine_metrics',
    description:
      'Get time-series machine metrics (CPU, memory, disk, network) for a given period. ' +
      'Use for trend analysis and historical performance investigation. ' +
      'Complements get_machine_stats (point-in-time snapshot) with historical data.',
    schema: zGetMachineMetricsData,
    sdkFn: getMachineMetrics,
    params: 'query' as const,
    execute: async (inputData: any, ctx: unknown) => {
      try {
        return await sdkCall(ctx, getMachineMetrics, { query: inputData });
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  getMachineMetricsSummary: {
    id: 'get_machine_metrics_summary',
    description:
      'Get a summarized overview of machine metrics: averages, peaks, and trends. ' +
      'Use for quick health assessments without processing raw time-series data.',
    schema: zGetMachineMetricsSummaryData,
    sdkFn: getMachineMetricsSummary,
    params: 'query' as const,
    execute: async (inputData: any, ctx: unknown) => {
      try {
        return await sdkCall(ctx, getMachineMetricsSummary, { query: inputData });
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  getMachineEvents: {
    id: 'get_machine_events',
    description:
      'Get machine lifecycle events (restarts, pauses, failures, state transitions). ' +
      'Use to investigate what happened to the machine over time, correlate with incidents.',
    schema: zGetMachineEventsData,
    sdkFn: getMachineEvents,
    params: 'query' as const,
    execute: async (inputData: any, ctx: unknown) => {
      try {
        return await sdkCall(ctx, getMachineEvents, { query: inputData });
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
});

export const getMachineStatsTool = tools.getMachineStats;
export const hostExecTool = tools.hostExec;
export const getMachineLifecycleStatusTool = tools.getMachineLifecycleStatus;
export const restartMachineTool = tools.restartMachine;
export const pauseMachineTool = tools.pauseMachine;
export const resumeMachineTool = tools.resumeMachine;
export const getMachineMetricsTool = tools.getMachineMetrics;
export const getMachineMetricsSummaryTool = tools.getMachineMetricsSummary;
export const getMachineEventsTool = tools.getMachineEvents;
export const machineTools = tools;
