import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';

/**
 * AtomicFileStorage - Provides atomic file operations with write queuing and backup support
 *
 * Features:
 * - Atomic writes using temp file + rename
 * - Operation queue to prevent concurrent write conflicts
 * - Automatic backups with configurable retention
 * - File locking to prevent race conditions
 * - Retry logic for transient failures
 */

interface WriteOperation {
  filePath: string;
  data: string;
  resolve: (value: void) => void;
  reject: (error: Error) => void;
}

interface BackupConfig {
  enabled: boolean;
  maxBackups: number;
  backupDir: string;
}

export class AtomicFileStorage {
  private writeQueue: WriteOperation[] = [];
  private isProcessing = false;
  private locks = new Map<string, Promise<void>>();
  private backupConfig: BackupConfig;

  constructor(backupConfig?: Partial<BackupConfig>) {
    const userDataPath = app.getPath('userData');
    this.backupConfig = {
      enabled: backupConfig?.enabled ?? true,
      maxBackups: backupConfig?.maxBackups ?? 5,
      backupDir: backupConfig?.backupDir ?? path.join(userDataPath, '.whiteboards', '.backups'),
    };

    if (this.backupConfig.enabled) {
      fs.ensureDirSync(this.backupConfig.backupDir);
    }
  }

  /**
   * Atomically write data to a file using temp file + rename pattern
   * Operations are queued to prevent concurrent writes to the same file
   */
  async writeFile(filePath: string, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({ filePath, data, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Read file with retry logic
   */
  async readFile(filePath: string): Promise<string> {
    return this.withRetry(async () => {
      return await fs.readFile(filePath, 'utf-8');
    }, 3);
  }

  /**
   * Read and parse JSON file with validation
   */
  async readJSON<T>(filePath: string): Promise<T> {
    const content = await this.readFile(filePath);
    try {
      return JSON.parse(content) as T;
    } catch (error) {
      throw new Error(`Failed to parse JSON from ${filePath}: ${error}`);
    }
  }

  /**
   * Atomically write JSON data to file
   */
  async writeJSON(filePath: string, data: any): Promise<void> {
    const jsonString = JSON.stringify(data, null, 2);
    await this.writeFile(filePath, jsonString);
  }

  /**
   * Check if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    return fs.pathExists(filePath);
  }

  /**
   * Process write queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.writeQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.writeQueue.length > 0) {
      const operation = this.writeQueue.shift()!;

      try {
        await this.executeWrite(operation.filePath, operation.data);
        operation.resolve();
      } catch (error) {
        operation.reject(error as Error);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Execute atomic write operation
   */
  private async executeWrite(filePath: string, data: string): Promise<void> {
    // Acquire lock for this file
    await this.acquireLock(filePath);

    try {
      // Create backup before writing
      if (this.backupConfig.enabled && await fs.pathExists(filePath)) {
        await this.createBackup(filePath);
      }

      // Ensure directory exists
      await fs.ensureDir(path.dirname(filePath));

      // Write to temporary file first
      const tempPath = `${filePath}.tmp.${Date.now()}`;

      await this.withRetry(async () => {
        await fs.writeFile(tempPath, data, 'utf-8');
      }, 3);

      // Verify the write was successful
      const written = await fs.readFile(tempPath, 'utf-8');
      if (written !== data) {
        throw new Error('Write verification failed: content mismatch');
      }

      // Atomic rename
      await fs.rename(tempPath, filePath);

    } finally {
      // Release lock
      this.releaseLock(filePath);
    }
  }

  /**
   * Create a timestamped backup of a file
   */
  private async createBackup(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    const backupPath = path.join(this.backupConfig.backupDir, `${filename}.${timestamp}.bak`);

    await fs.copy(filePath, backupPath);

    // Clean old backups
    await this.cleanOldBackups(filename);
  }

  /**
   * Remove old backups, keeping only the most recent N
   */
  private async cleanOldBackups(filename: string): Promise<void> {
    const backupPattern = new RegExp(`^${this.escapeRegExp(filename)}\\..*\\.bak$`);
    const files = await fs.readdir(this.backupConfig.backupDir);

    const backups = files
      .filter(f => backupPattern.test(f))
      .map(f => ({
        name: f,
        path: path.join(this.backupConfig.backupDir, f),
        time: fs.statSync(path.join(this.backupConfig.backupDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    // Remove backups beyond the retention limit
    const toRemove = backups.slice(this.backupConfig.maxBackups);
    for (const backup of toRemove) {
      await fs.remove(backup.path);
    }
  }

  /**
   * Restore from the most recent backup
   */
  async restoreFromBackup(filePath: string): Promise<boolean> {
    const filename = path.basename(filePath);
    const backupPattern = new RegExp(`^${this.escapeRegExp(filename)}\\..*\\.bak$`);
    const files = await fs.readdir(this.backupConfig.backupDir);

    const backups = files
      .filter(f => backupPattern.test(f))
      .map(f => ({
        name: f,
        path: path.join(this.backupConfig.backupDir, f),
        time: fs.statSync(path.join(this.backupConfig.backupDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    if (backups.length === 0) {
      return false;
    }

    // Restore from most recent backup
    await fs.copy(backups[0].path, filePath, { overwrite: true });
    return true;
  }

  /**
   * Acquire a lock for a file path
   */
  private async acquireLock(filePath: string): Promise<void> {
    const existingLock = this.locks.get(filePath);
    if (existingLock) {
      await existingLock;
    }

    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(filePath, lockPromise);
  }

  /**
   * Release a lock for a file path
   */
  private releaseLock(filePath: string): void {
    const lock = this.locks.get(filePath);
    if (lock) {
      this.locks.delete(filePath);
    }
  }

  /**
   * Execute an operation with retry logic
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    delayMs: number = 100
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          await this.delay(delayMs * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }

    throw new Error(`Operation failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get statistics about the write queue
   */
  getQueueStats() {
    return {
      queueLength: this.writeQueue.length,
      isProcessing: this.isProcessing,
      activeLocks: this.locks.size,
    };
  }

  /**
   * Wait for all pending operations to complete
   */
  async flush(): Promise<void> {
    while (this.writeQueue.length > 0 || this.isProcessing) {
      await this.delay(50);
    }
  }
}

// Singleton instance
let instance: AtomicFileStorage | null = null;

export function getAtomicFileStorage(): AtomicFileStorage {
  if (!instance) {
    instance = new AtomicFileStorage();
  }
  return instance;
}
