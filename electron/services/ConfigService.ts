import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'

interface AppConfig {
  lastOpenedVault: string | null
  recentVaults: string[]
}

export class ConfigService {
  private configPath: string
  private config: AppConfig = {
    lastOpenedVault: null,
    recentVaults: []
  }

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'config.json')
  }

  async init(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      const parsedConfig = JSON.parse(data)
      // Merge with defaults to handle missing fields in existing config
      this.config = { ...this.config, ...parsedConfig }
      if (!this.config.recentVaults) {
        this.config.recentVaults = []
      }
    } catch (error) {
      // Config file doesn't exist or is invalid, use default
      console.log('No config file found or invalid, using defaults')
    }
  }

  getLastOpenedVault(): string | null {
    return this.config.lastOpenedVault
  }

  getRecentVaults(): string[] {
    return this.config.recentVaults
  }

  async setLastOpenedVault(vaultPath: string | null): Promise<void> {
    this.config.lastOpenedVault = vaultPath

    if (vaultPath) {
      // Add to recent vaults
      const recent = this.config.recentVaults.filter(p => p !== vaultPath)
      recent.unshift(vaultPath)
      // Limit to 5 recent vaults
      this.config.recentVaults = recent.slice(0, 5)
    }

    await this.saveConfig()
  }

  private async saveConfig(): Promise<void> {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (error) {
      console.error('Error saving config:', error)
    }
  }
}
