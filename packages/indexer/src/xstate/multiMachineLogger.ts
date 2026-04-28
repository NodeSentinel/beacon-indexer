// logger.ts
import fs from 'fs';
import path from 'path';

import { cleanContextForLogging as cleanContextForLoggingUtil } from './loggingUtils.js';
import { getMachineTracer } from './machineTracer.js';
import type { TraceOptions } from './traceTypes.js';

interface MachineLogEntry {
  timestamp: string;
  state: unknown;
  context?: Record<string, unknown>;
}

interface MachineLogger {
  machineId: string;
  currentLog: MachineLogEntry | null;
  isFinal: boolean;
}

export class MultiMachineLogger {
  private machines: Map<string, MachineLogger> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private logFilePath: string;

  constructor() {
    // Create logs directory if it doesn't exist
    const logsDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    this.logFilePath = path.join(logsDir, 'machines-status.json');

    // Start the display update loop
    this.startDisplayLoop();
  }

  /**
   * Register a new machine or get existing one
   */
  private getOrCreateMachine(machineId: string): MachineLogger {
    if (!this.machines.has(machineId)) {
      this.machines.set(machineId, {
        machineId,
        currentLog: null,
        isFinal: false,
      });
    }
    return this.machines.get(machineId)!;
  }

  /**
   * Add or update a machine log entry
   * This function handles both machine registration and state updates
   */
  addLog(machineId: string, state: unknown, context?: Record<string, unknown>) {
    const machine = this.getOrCreateMachine(machineId);

    // Don't update if machine is already in final state
    if (machine.isFinal) {
      return;
    }

    const timestamp = new Date().toLocaleTimeString();

    const logEntry: MachineLogEntry = {
      timestamp,
      state,
      context,
    };

    machine.currentLog = logEntry;
  }

  /**
   * Mark a machine as final and schedule it for removal from memory
   * This is the event-based way to signal final states
   */
  markMachineAsFinal(machineId: string, finalState?: string) {
    const machine = this.machines.get(machineId);
    if (!machine) {
      return;
    }

    // Update the final state if provided
    if (finalState) {
      machine.currentLog = {
        timestamp: new Date().toLocaleTimeString(),
        state: finalState,
        context: machine.currentLog?.context,
      };
    }

    // Mark as final
    machine.isFinal = true;

    // Remove from memory after a short delay
    setTimeout(() => {
      this.machines.delete(machineId);
      // console.log(`Machine ${machineId} removed from memory after reaching final state`);
    }, 3000); // 3 second delay to show final state
  }

  /**
   * Remove a machine from tracking with a final log
   */
  removeMachine(machineId: string) {
    if (this.machines.has(machineId)) {
      // Log final state before removal
      const machine = this.machines.get(machineId)!;
      machine.currentLog = {
        timestamp: new Date().toLocaleTimeString(),
        state: 'Machine removed',
        context: machine.currentLog?.context,
      };
      machine.isFinal = true;
      // Remove after a short delay to show the final state
      setTimeout(() => {
        this.machines.delete(machineId);
      }, 2000);
    }
  }

  /**
   * Update the display with all machine logs in JSON format
   */
  private updateDisplay() {
    const statusData = {
      timestamp: new Date().toISOString(),
      machines: {} as Record<
        string,
        {
          status: 'final' | 'active' | 'waiting';
          lastUpdate: string | null;
          state: unknown;
          context: Record<string, unknown> | null;
          isFinal?: boolean;
        }
      >,
    };

    // Add machine data
    for (const [machineId, machine] of this.machines) {
      if (machine.currentLog) {
        statusData.machines[machineId] = {
          status: machine.isFinal ? 'final' : 'active',
          lastUpdate: machine.currentLog.timestamp,
          state: this.parseState(machine.currentLog.state),
          context: machine.currentLog.context
            ? cleanContextForLoggingUtil(machine.currentLog.context) || null
            : null,
          isFinal: machine.isFinal,
        };
      } else {
        statusData.machines[machineId] = {
          status: 'waiting',
          lastUpdate: null,
          state: null,
          context: null,
        };
      }
    }

    // Write JSON to file
    try {
      fs.writeFileSync(this.logFilePath, JSON.stringify(statusData, null, 2) + '\n');
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }

  /**
   * Start the display update loop
   */
  private startDisplayLoop() {
    // Initial display update
    this.updateDisplay();

    this.updateInterval = setInterval(() => {
      this.updateDisplay();
    }, 1000); // Update every 1 second
  }

  /**
   * Stop the display loop and persist the final state
   */
  done() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Write final status with machines state
    const finalStatus: {
      timestamp: string;
      summary: {
        totalMachines: number;
        activeMachines: number;
        lastUpdate: string;
        status: 'stopped';
        message: string;
      };
      machines: Record<
        string,
        {
          status: 'stopped';
          lastUpdate: string | null;
          state: {
            current?: unknown;
            previous?: unknown;
            type?: string;
          } | null;
          context: Record<string, unknown> | null;
        }
      >;
    } = {
      timestamp: new Date().toISOString(),
      summary: {
        totalMachines: this.machines.size,
        activeMachines: Array.from(this.machines.values()).filter((m) => m.currentLog).length,
        lastUpdate: new Date().toLocaleString(),
        status: 'stopped',
        message: 'Multi-machine logger stopped',
      },
      machines: {},
    };

    // Add final machine states
    for (const [machineId, machine] of this.machines) {
      if (machine.currentLog) {
        finalStatus.machines[machineId] = {
          status: 'stopped',
          lastUpdate: machine.currentLog.timestamp,
          state: this.parseState(machine.currentLog.state) as {
            current?: unknown;
            previous?: unknown;
            type?: string;
          },
          context: machine.currentLog.context
            ? cleanContextForLoggingUtil(machine.currentLog.context) || null
            : null,
        };
      } else {
        finalStatus.machines[machineId] = {
          status: 'stopped',
          lastUpdate: null,
          state: null,
          context: null,
        };
      }
    }

    // Write final status to file (overwrite completely)
    try {
      fs.writeFileSync(this.logFilePath, JSON.stringify(finalStatus, null, 2) + '\n');
    } catch (error) {
      console.error('Error writing final status:', error);
    }

    getMachineTracer().done();
  }

  /**
   * Get the log file path for external monitoring
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Parse and clean state data - handles JSON parsing and removes prefixes
   */
  private parseState(state: unknown): unknown {
    if (typeof state !== 'string') {
      return state;
    }

    const cleanState = state.replace(/^State:\s*/, '');

    try {
      return JSON.parse(cleanState) as unknown;
    } catch {
      return cleanState;
    }
  }
}

// Global instance
let globalMultiLogger: MultiMachineLogger | null = null;

/**
 * Get or create the global multi-machine logger instance
 */
export const getMultiMachineLogger = (): MultiMachineLogger => {
  if (!globalMultiLogger) {
    globalMultiLogger = new MultiMachineLogger();
  }
  return globalMultiLogger;
};

/**
 * Mark a machine as final and schedule it for removal from memory
 * Use this function when you know a machine has reached its final state
 */
export const logRemoveMachine = (machineId: string, finalState?: string) => {
  const logger = getMultiMachineLogger();
  getMachineTracer().finalizeTrace(machineId, finalState);
  logger.markMachineAsFinal(machineId, finalState);
};

/**
 * Unified function to log machine state (handles both registration and updates)
 * Use this for all machine logging - it will automatically handle machine registration
 */
export const logMachine = (
  machineId: string,
  state: unknown,
  context?: Record<string, unknown>,
  traceOptions?: TraceOptions,
) => {
  const logger = getMultiMachineLogger();
  logger.addLog(machineId, state, context);

  const tracer = getMachineTracer();
  const definition = traceOptions?.buildTrace
    ? traceOptions.buildTrace({
        machineId,
        state,
        context,
        traceRootId: traceOptions.traceRootId,
        parentMachineId: traceOptions.parentMachineId,
      })
    : tracer.createDefaultDefinition(machineId, state, traceOptions);

  tracer.trackTrace(machineId, definition);
};

/**
 * Remove a machine from tracking
 */
export const removeMachine = (machineId: string) => {
  const logger = getMultiMachineLogger();
  logger.removeMachine(machineId);
  getMachineTracer().finalizeTrace(machineId);
};

/**
 * Clean context data to remove circular references and non-serializable objects
 * Helper function to clean context before serialization
 */
export function cleanContextForLogging(context: unknown): Record<string, unknown> | undefined {
  return cleanContextForLoggingUtil(context);
}

/**
 * Automatically log an actor's state and context
 * This function handles both initial registration and continuous state updates
 * @param actor The XState actor to log
 * @param machineId Optional custom machine ID, defaults to actor.id
 */
export const logActor = (
  actor: {
    id: string;
    subscribe: (callback: (snapshot: { value: unknown; context?: unknown }) => void) => void;
  },
  machineId?: string,
  traceOptions?: TraceOptions,
) => {
  const id = machineId || actor.id;

  // Subscribe to the actor's state changes
  actor.subscribe((snapshot) => {
    const { context } = snapshot;
    // Clean context before logging to avoid circular references
    const cleanedContext = cleanContextForLogging(context);
    logMachine(id, snapshot.value, cleanedContext, traceOptions);
  });
};

// Backward compatibility aliases
/**
 * @deprecated Use logMachine instead
 */
export const addMachineLog = logMachine;
