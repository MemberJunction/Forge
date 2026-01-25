/**
 * AI IPC Handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';
import type {
  AISettings,
  TabRenameRequest,
  AnalysisRequest,
  SQLGenerationRequest,
} from '@mj-forge/shared';
import { AIService } from '../services/ai/ai-service';

export function registerAIHandlers(): void {
  const aiService = AIService.getInstance();

  // Get available vendors
  ipcMain.handle(IPC_CHANNELS.AI.GET_VENDORS, () => {
    return aiService.getVendors();
  });

  // Get current settings
  ipcMain.handle(IPC_CHANNELS.AI.GET_SETTINGS, () => {
    return aiService.getSettings();
  });

  // Update settings
  ipcMain.handle(IPC_CHANNELS.AI.SET_SETTINGS, async (_event, settings: Partial<AISettings>) => {
    await aiService.setSettings(settings);
    return aiService.getSettings();
  });

  // Set API key for a vendor
  ipcMain.handle(IPC_CHANNELS.AI.SET_API_KEY, async (_event, vendorId: string, apiKey: string) => {
    await aiService.setApiKey(vendorId, apiKey);
    return true;
  });

  // Remove API key for a vendor
  ipcMain.handle(IPC_CHANNELS.AI.REMOVE_API_KEY, async (_event, vendorId: string) => {
    await aiService.removeApiKey(vendorId);
    return true;
  });

  // Validate API key
  ipcMain.handle(
    IPC_CHANNELS.AI.VALIDATE_API_KEY,
    async (_event, vendorId: string, apiKey: string) => {
      return aiService.validateApiKey(vendorId, apiKey);
    }
  );

  // Generate tab name
  ipcMain.handle(IPC_CHANNELS.AI.GENERATE_TAB_NAME, async (_event, request: TabRenameRequest) => {
    return aiService.generateTabName(request);
  });

  // Analyze results
  ipcMain.handle(IPC_CHANNELS.AI.ANALYZE_RESULTS, async (_event, request: AnalysisRequest) => {
    return aiService.analyzeResults(request);
  });

  // Generate SQL
  ipcMain.handle(IPC_CHANNELS.AI.GENERATE_SQL, async (_event, request: SQLGenerationRequest) => {
    return aiService.generateSQL(request);
  });

  // Cancel request
  ipcMain.handle(IPC_CHANNELS.AI.CANCEL_REQUEST, (_event, requestId: string) => {
    aiService.cancelRequest(requestId);
    return true;
  });
}
