/**
 * Module Service
 * Handles all module-related API calls
 */

import { BaseAPIService } from './api.service';
import type { Module, ModuleContent, ParseProgress, ModuleAsset } from '~/types';

export interface ModuleUploadResponse {
  module_id: string;
  message: string;
}

export interface ParseRequest {
  use_ai?: boolean;
  parse_chapters?: boolean;
  parse_monsters?: boolean;
  parse_items?: boolean;
  parse_maps?: boolean;
}

class ModuleService extends BaseAPIService {
  /**
   * Get all modules
   */
  async getModules(): Promise<Module[]> {
    return this.get<Module[]>('/api/modules');
  }

  /**
   * Get parsed modules
   */
  async getParsedModules(): Promise<Module[]> {
    return this.get<Module[]>('/api/modules/parsed');
  }

  /**
   * Get module by ID
   */
  async getModule(moduleId: string): Promise<Module> {
    return this.get<Module>(`/api/modules/${moduleId}`);
  }

  /**
   * Get parsed module content
   */
  async getParsedModule(moduleId: string): Promise<ModuleContent> {
    return this.get<ModuleContent>(`/api/modules/parsed/${moduleId}`);
  }

  /**
   * Upload module file
   */
  async uploadModule(file: File): Promise<ModuleUploadResponse> {
    return this.upload<ModuleUploadResponse>('/api/modules/upload', file);
  }

  /**
   * Start module parsing
   */
  async startParsing(
    moduleId: string,
    options?: ParseRequest
  ): Promise<{ message: string; task_id: string }> {
    return this.post(`/api/modules/${moduleId}/parse`, options);
  }

  /**
   * Get parsing status
   */
  async getParseStatus(moduleId: string): Promise<ParseProgress> {
    return this.get<ParseProgress>(`/api/modules/${moduleId}/parse-status`);
  }

  /**
   * Get module asset
   */
  async getModuleAsset(moduleId: string, assetPath: string): Promise<unknown> {
    return this.get(`/api/modules/parsed/${moduleId}/asset`, {
      params: { path: assetPath }
    });
  }

  /**
   * List module assets
   */
  async listModuleAssets(moduleId: string): Promise<ModuleAsset[]> {
    return this.get<ModuleAsset[]>(`/api/modules/parsed/${moduleId}/assets`);
  }

  /**
   * Delete module
   */
  async deleteModule(moduleId: string): Promise<void> {
    return this.delete(`/api/modules/${moduleId}`);
  }

  /**
   * Export module
   */
  async exportModule(moduleId: string, format: 'json' | 'pdf' = 'json'): Promise<Blob> {
    const url = this.buildUrl(`/api/modules/${moduleId}/export`, { format });

    const response = await fetch(url, {
      method: 'GET',
      headers: this.defaultHeaders
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    return response.blob();
  }

  /**
   * Get chapter tree with content
   */
  async getChapterTree(moduleId: string): Promise<unknown> {
    return this.getModuleAsset(moduleId, 'chapter_tree_with_content.json');
  }

  /**
   * Get module monsters
   */
  async getModuleMonsters(moduleId: string): Promise<unknown[]> {
    try {
      return await this.getModuleAsset(moduleId, 'monsters.json') as unknown[];
    } catch {
      return [];
    }
  }

  /**
   * Get module items
   */
  async getModuleItems(moduleId: string): Promise<unknown[]> {
    try {
      return await this.getModuleAsset(moduleId, 'items.json') as unknown[];
    } catch {
      return [];
    }
  }

  /**
   * Get module images/maps
   */
  async getModuleImages(moduleId: string): Promise<unknown[]> {
    try {
      return await this.getModuleAsset(moduleId, 'images.json') as unknown[];
    } catch {
      return [];
    }
  }
}

export const moduleService = new ModuleService();