import * as path from 'path';
import { getAtomicFileStorage } from './AtomicFileStorage';
import { DataValidator, type Whiteboard } from './DataValidator';
import { app } from 'electron';

/**
 * DataRecovery - Handles corruption detection and recovery
 *
 * Features:
 * - Automatic corruption detection
 * - Recovery from backups
 * - Data integrity verification
 * - User notifications about recovery actions
 */

export interface RecoveryReport {
  success: boolean;
  recovered: boolean;
  errors: string[];
  recoveredFrom?: string;
  sanitized: boolean;
}

export class DataRecovery {
  private storage = getAtomicFileStorage();
  private whiteboardsDir: string;

  constructor(vaultPath: string) {
    this.whiteboardsDir = path.join(vaultPath, '.whiteboards');
  }

  /**
   * Attempt to load and validate a whiteboard, with automatic recovery
   */
  async loadWhiteboardSafely(whiteboardId: string): Promise<{ whiteboard: Whiteboard | null; report: RecoveryReport }> {
    const whiteboardPath = path.join(this.whiteboardsDir, `${whiteboardId}.json`);
    const report: RecoveryReport = {
      success: false,
      recovered: false,
      errors: [],
      sanitized: false,
    };

    // Try to load the whiteboard
    try {
      const exists = await this.storage.exists(whiteboardPath);
      if (!exists) {
        report.errors.push('Whiteboard file does not exist');
        return { whiteboard: null, report };
      }

      const data = await this.storage.readJSON<Whiteboard>(whiteboardPath);

      // Validate the data
      const validationResult = DataValidator.validateWhiteboard(data);

      if (validationResult.valid) {
        report.success = true;
        return { whiteboard: data, report };
      }

      // Data is invalid, try to sanitize it
      console.warn(`Whiteboard ${whiteboardId} has validation errors:`, validationResult.errors);
      report.errors.push(...validationResult.errors);

      const sanitized = DataValidator.sanitizeWhiteboard(data);
      const sanitizedValidation = DataValidator.validateWhiteboard(sanitized);

      if (sanitizedValidation.valid) {
        // Save the sanitized version
        await this.storage.writeJSON(whiteboardPath, sanitized);
        report.success = true;
        report.sanitized = true;
        console.log(`Successfully sanitized whiteboard ${whiteboardId}`);
        return { whiteboard: sanitized, report };
      }

      // Sanitization failed, try to recover from backup
      console.error(`Failed to sanitize whiteboard ${whiteboardId}, attempting backup recovery`);
      const recovered = await this.recoverFromBackup(whiteboardPath);

      if (recovered) {
        const recoveredData = await this.storage.readJSON<Whiteboard>(whiteboardPath);
        const recoveredValidation = DataValidator.validateWhiteboard(recoveredData);

        if (recoveredValidation.valid) {
          report.success = true;
          report.recovered = true;
          report.recoveredFrom = 'backup';
          console.log(`Successfully recovered whiteboard ${whiteboardId} from backup`);
          return { whiteboard: recoveredData, report };
        }
      }

      // All recovery attempts failed
      report.errors.push('All recovery attempts failed');
      return { whiteboard: null, report };

    } catch (error) {
      console.error(`Error loading whiteboard ${whiteboardId}:`, error);
      report.errors.push(`Load error: ${error}`);

      // Try to recover from backup
      const recovered = await this.recoverFromBackup(whiteboardPath);

      if (recovered) {
        try {
          const recoveredData = await this.storage.readJSON<Whiteboard>(whiteboardPath);
          report.success = true;
          report.recovered = true;
          report.recoveredFrom = 'backup';
          console.log(`Successfully recovered whiteboard ${whiteboardId} from backup after error`);
          return { whiteboard: recoveredData, report };
        } catch (recoveryError) {
          report.errors.push(`Recovery error: ${recoveryError}`);
        }
      }

      return { whiteboard: null, report };
    }
  }

  /**
   * Attempt to recover a file from backup
   */
  private async recoverFromBackup(filePath: string): Promise<boolean> {
    try {
      return await this.storage.restoreFromBackup(filePath);
    } catch (error) {
      console.error('Failed to recover from backup:', error);
      return false;
    }
  }

  /**
   * Verify integrity of all whiteboards
   */
  async verifyAllWhiteboards(whiteboardIds: string[]): Promise<Map<string, RecoveryReport>> {
    const results = new Map<string, RecoveryReport>();

    for (const whiteboardId of whiteboardIds) {
      const { report } = await this.loadWhiteboardSafely(whiteboardId);
      results.set(whiteboardId, report);
    }

    return results;
  }

  /**
   * Create an emergency backup of all whiteboards
   */
  async createEmergencyBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    const emergencyDir = path.join(this.whiteboardsDir, '.emergency-backups', timestamp);

    const fs = require('fs-extra');
    await fs.copy(this.whiteboardsDir, emergencyDir, {
      filter: (src: string) => {
        // Don't copy backup directories
        return !src.includes('.backups') && !src.includes('.emergency-backups');
      }
    });

    console.log(`Created emergency backup at: ${emergencyDir}`);
    return emergencyDir;
  }

  /**
   * Get storage statistics
   */
  async getStorageStats() {
    return {
      queueStats: this.storage.getQueueStats(),
      whiteboardsDir: this.whiteboardsDir,
    };
  }

  /**
   * Force flush all pending writes (useful before app close)
   */
  async flush(): Promise<void> {
    await this.storage.flush();
  }
}
