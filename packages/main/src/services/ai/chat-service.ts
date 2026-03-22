/**
 * Chat Service - Orchestrates AI chat with tool calling
 */

import { app, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ChatMessage,
  ChatRequest,
  ChatStreamChunk,
  Conversation,
  ToolCallResult,
  ToolDefinition,
} from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { AIService } from './ai-service';
import { ToolRegistry } from './tool-registry';

const log = createLogger('Chat');

// Google Gemini response types
interface GeminiCandidate {
  content?: {
    parts?: Array<{
      text?: string;
      functionCall?: { name: string; args: Record<string, unknown> };
    }>;
  };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

export class ChatService extends BaseSingleton {
  private conversations: Map<string, Conversation> = new Map();
  private toolRegistry: ToolRegistry;
  private aiService: AIService;
  private activeStreams: Map<string, AbortController> = new Map();
  private storageDir: string;

  constructor() {
    super();
    this.toolRegistry = ToolRegistry.getInstance();
    this.aiService = AIService.getInstance();
    this.storageDir = path.join(app.getPath('userData'), 'chat-history');
    this.loadConversations();
  }

  // ---- Persistence ----

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private loadConversations(): void {
    try {
      this.ensureStorageDir();
      const files = fs.readdirSync(this.storageDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = fs.readFileSync(path.join(this.storageDir, file), 'utf-8');
          const conv = JSON.parse(data) as Conversation;
          if (conv.id && conv.title) {
            this.conversations.set(conv.id, conv);
          }
        } catch {
          log.warn(`Failed to load conversation file: ${file}`);
        }
      }
      log.info(`Loaded ${this.conversations.size} conversations from disk`);
    } catch {
      log.warn('Failed to load conversations directory');
    }
  }

  private saveConversation(conv: Conversation): void {
    try {
      this.ensureStorageDir();
      const filePath = path.join(this.storageDir, `${conv.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(conv, null, 2), 'utf-8');
    } catch (error) {
      log.error('Failed to save conversation:', error);
    }
  }

  private deleteConversationFile(id: string): void {
    try {
      const filePath = path.join(this.storageDir, `${id}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      log.error('Failed to delete conversation file:', error);
    }
  }

  getTools(): ToolDefinition[] {
    return this.toolRegistry.getTools();
  }

  listConversations(): Conversation[] {
    return Array.from(this.conversations.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  getConversation(id: string): Conversation | null {
    return this.conversations.get(id) || null;
  }

  createConversation(title?: string): Conversation {
    const conversation: Conversation = {
      id: uuidv4(),
      title: title || 'New Chat',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.conversations.set(conversation.id, conversation);
    this.saveConversation(conversation);
    return conversation;
  }

  deleteConversation(id: string): boolean {
    this.cancelStream(id);
    this.deleteConversationFile(id);
    return this.conversations.delete(id);
  }

  renameConversation(id: string, title: string): Conversation | null {
    const conv = this.conversations.get(id);
    if (!conv) return null;
    conv.title = title;
    conv.updatedAt = new Date().toISOString();
    this.saveConversation(conv);
    return conv;
  }

  cancelStream(conversationId: string): void {
    const controller = this.activeStreams.get(conversationId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(conversationId);
    }
  }

  /**
   * Send a message and stream the response back via IPC events
   */
  async sendMessage(request: ChatRequest, mainWindow: BrowserWindow): Promise<void> {
    let conversation = this.conversations.get(request.conversationId);
    if (!conversation) {
      conversation = this.createConversation();
      conversation.id = request.conversationId;
      this.conversations.set(conversation.id, conversation);
    }

    // Store context
    if (request.connectionId) conversation.connectionId = request.connectionId;
    if (request.databaseName) conversation.databaseName = request.databaseName;

    // Add user message
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: request.message,
      timestamp: new Date().toISOString(),
    };
    conversation.messages.push(userMessage);
    conversation.updatedAt = new Date().toISOString();

    // Auto-title on first message
    if (conversation.messages.filter(m => m.role === 'user').length === 1) {
      conversation.title = request.message.substring(0, 50) + (request.message.length > 50 ? '...' : '');
    }
    this.saveConversation(conversation);

    const abortController = new AbortController();
    this.activeStreams.set(conversation.id, abortController);

    try {
      await this.generateResponse(conversation, request, mainWindow, abortController.signal);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        log.error('Chat error:', error);
        this.sendChunk(mainWindow, {
          conversationId: conversation.id,
          delta: `\n\nError: ${(error as Error).message}`,
          done: true,
        });
      }
    } finally {
      this.activeStreams.delete(conversation.id);
    }
  }

  /**
   * Confirm a pending tool call
   */
  async confirmToolCall(
    conversationId: string,
    toolCallId: string,
    confirmed: boolean,
    mainWindow: BrowserWindow
  ): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;

    if (confirmed) {
      // Find the pending tool call in the last assistant message
      const lastMsg = [...conversation.messages].reverse().find(m => m.role === 'assistant');
      const toolCall = lastMsg?.toolCalls?.find(tc => tc.id === toolCallId);
      if (toolCall) {
        const start = Date.now();
        try {
          const result = await this.toolRegistry.executeTool(
            toolCall.toolName,
            toolCall.args,
            conversation.connectionId,
            conversation.databaseName
          );
          toolCall.result = result;
          toolCall.success = true;
          toolCall.confirmed = true;
          toolCall.durationMs = Date.now() - start;
        } catch (error) {
          toolCall.error = (error as Error).message;
          toolCall.success = false;
          toolCall.confirmed = true;
          toolCall.durationMs = Date.now() - start;
        }

        this.saveConversation(conversation);
        this.sendChunk(mainWindow, {
          conversationId,
          toolResult: toolCall,
          done: false,
        });
      }
    } else {
      this.sendChunk(mainWindow, {
        conversationId,
        delta: '\n\nTool call cancelled by user.',
        done: true,
      });
    }
  }

  private async generateResponse(
    conversation: Conversation,
    request: ChatRequest,
    mainWindow: BrowserWindow,
    signal: AbortSignal
  ): Promise<void> {
    const { model: _model, provider: _provider, apiKey } = await (this.aiService as any).selectModelForFeature('queryAssist');
    if (!apiKey) {
      this.sendChunk(mainWindow, {
        conversationId: conversation.id,
        delta: 'No AI provider configured. Go to Settings to add an API key.',
        done: true,
      });
      return;
    }

    // Build messages for the API
    const systemPrompt = this.buildSystemPrompt(request);
    const tools = this.toolRegistry.getToolsForAPI();

    // Use Google Gemini API with function calling
    const contents = this.buildGeminiContents(conversation.messages);

    const body: Record<string, unknown> = {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.7,
      },
    };

    if (tools.length > 0) {
      body.tools = [{ functionDeclarations: tools }];
    }

    // Get the model name — try to use the configured model, fallback to gemini-2.5-flash-lite
    const settings = this.aiService.getSettings();
    let modelName = 'gemini-2.5-flash-lite';
    const googleVendor = settings.vendorSettings.find(v => v.vendorId === 'google');
    if (googleVendor?.preferredModelId) {
      // Look up the API name from vendors
      const vendors = this.aiService.getVendors();
      const google = vendors.find(v => v.id === 'google');
      const model = google?.models.find(m => m.id === googleVendor.preferredModelId);
      if (model) modelName = model.apiName;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];

    if (!candidate?.content?.parts) {
      this.sendChunk(mainWindow, {
        conversationId: conversation.id,
        delta: 'No response from AI.',
        done: true,
      });
      return;
    }

    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      toolCalls: [],
    };

    for (const part of candidate.content.parts) {
      if (signal.aborted) break;

      if (part.text) {
        assistantMessage.content += part.text;
        this.sendChunk(mainWindow, {
          conversationId: conversation.id,
          delta: part.text,
          done: false,
        });
      }

      if (part.functionCall) {
        const toolDef = this.toolRegistry.getTool(part.functionCall.name);
        const toolCallId = uuidv4();

        if (toolDef?.requiresConfirmation) {
          // Send pending confirmation
          const pendingCall: ToolCallResult = {
            id: toolCallId,
            toolName: part.functionCall.name,
            args: part.functionCall.args || {},
            success: false,
          };
          assistantMessage.toolCalls!.push(pendingCall);

          this.sendChunk(mainWindow, {
            conversationId: conversation.id,
            toolCall: {
              id: toolCallId,
              toolName: part.functionCall.name,
              args: part.functionCall.args || {},
              pendingConfirmation: true,
            },
            done: false,
          });
        } else {
          // Auto-execute non-dangerous tools
          const start = Date.now();
          const toolResult: ToolCallResult = {
            id: toolCallId,
            toolName: part.functionCall.name,
            args: part.functionCall.args || {},
            success: false,
          };

          try {
            const result = await this.toolRegistry.executeTool(
              part.functionCall.name,
              part.functionCall.args || {},
              conversation.connectionId,
              conversation.databaseName
            );
            toolResult.result = result;
            toolResult.success = true;
            toolResult.durationMs = Date.now() - start;
          } catch (error) {
            toolResult.error = (error as Error).message;
            toolResult.durationMs = Date.now() - start;
          }

          assistantMessage.toolCalls!.push(toolResult);

          this.sendChunk(mainWindow, {
            conversationId: conversation.id,
            toolResult,
            done: false,
          });
        }
      }
    }

    conversation.messages.push(assistantMessage);
    conversation.updatedAt = new Date().toISOString();
    this.saveConversation(conversation);

    this.sendChunk(mainWindow, {
      conversationId: conversation.id,
      done: true,
      messageId: assistantMessage.id,
    });
  }

  private buildSystemPrompt(request: ChatRequest): string {
    let prompt = `You are Forge AI, a helpful database assistant built into MJ Forge — a SQL Server management tool.
You help users manage their databases through natural conversation. You can execute SQL queries, create databases, inspect schema, and more using the available tools.

Guidelines:
- Be concise and helpful
- When the user asks about data, use the execute_query tool to run SQL
- When the user asks about schema, use describe_table or list_tables
- For destructive operations (DROP, DELETE, ALTER), explain what you'll do and use tools that require confirmation
- Format SQL code in markdown code blocks
- If you're unsure what the user wants, ask for clarification`;

    if (request.databaseName) {
      prompt += `\n\nCurrent database: ${request.databaseName}`;
    }

    if (request.schemaContext?.tables.length) {
      const tableList = request.schemaContext.tables
        .slice(0, 20) // Limit to 20 tables for context
        .map(t => `- ${t.schema}.${t.name} (${t.columns.map(c => c.name).join(', ')})`)
        .join('\n');
      prompt += `\n\nAvailable tables:\n${tableList}`;
    }

    return prompt;
  }

  private buildGeminiContents(messages: ChatMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '(empty)' }],
      }));
  }

  private sendChunk(mainWindow: BrowserWindow, chunk: ChatStreamChunk): void {
    try {
      mainWindow.webContents.send('chat:stream-chunk', chunk);
    } catch {
      // Window may have been closed
    }
  }
}
