/**
 * AI Chat Panel - Slide-out panel for AI assistant conversations
 */

import {
  Component,
  OnInit,
  inject,
  signal,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { ChatStateService } from '../../core/state/chat.state';
import { ConnectionStateService } from '../../core/state/connection.state';
import { AIStateService } from '../../core/state/ai.state';
import type { ToolCallResult } from '@mj-forge/shared';

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chat-panel" [class.collapsed]="!chatState.panelOpen()">
      <!-- Header -->
      <div class="chat-header">
        <span class="chat-icon">✨</span>
        <h3>AI Assistant</h3>
        <span class="badge">Gemini</span>
        <button class="chat-header-btn" (click)="chatState.toggleConversations()" title="Conversations">☰</button>
        <button class="chat-header-btn" (click)="chatState.closePanel()" title="Close">✕</button>
      </div>

      <!-- New Chat button -->
      <div class="new-chat-btn" (click)="chatState.newConversation()">+ New Chat</div>

      <!-- Conversation list -->
      @if (chatState.conversationsExpanded()) {
        <div class="chat-conversations">
          @for (conv of chatState.conversations(); track conv.id) {
            <div class="conv-item"
                 [class.active]="conv.id === chatState.activeConversationId()"
                 (click)="chatState.selectConversation(conv.id)">
              <span class="conv-title">{{ conv.title }}</span>
              <div class="conv-actions">
                <span class="conv-date">{{ formatDate(conv.updatedAt) }}</span>
                <button class="conv-delete" (click)="deleteConv($event, conv.id)" title="Delete">✕</button>
              </div>
            </div>
          }
          @if (!chatState.hasConversations()) {
            <div class="conv-empty">No conversations yet</div>
          }
        </div>
      }

      <!-- Messages area -->
      <div class="chat-messages" #messagesContainer>
        <!-- Context badge -->
        @if (connectionState.isConnected()) {
          <div class="context-badge">
            <span class="ctx-dot"></span>
            {{ connectionState.activeProfile()?.name || 'Connected' }}
            @if (connectionState.selectedDatabase()) {
              → {{ connectionState.selectedDatabase() }}
            }
          </div>
        }

        @if (!chatState.activeConversationId() && !chatState.streaming()) {
          @if (!aiState.hasConfiguredVendors()) {
            <!-- No AI configured -->
            <div class="chat-empty">
              <div class="chat-empty-icon">✨</div>
              <h4>Set Up AI</h4>
              <p>Configure an AI provider to enable the chat assistant, smart autocomplete, and result analysis.</p>
              <button class="setup-btn" (click)="openSetupDialog()">Set Up AI Provider</button>
            </div>
          } @else {
            <!-- Empty state -->
            <div class="chat-empty">
              <div class="chat-empty-icon">✨</div>
              <h4>Forge AI</h4>
              <p>Ask me anything about your database. I can query data, create tables, explore schema, and more.</p>
              <div class="suggestions">
                @for (s of suggestions; track s) {
                  <button class="suggestion-chip" (click)="sendSuggestion(s)">{{ s }}</button>
                }
              </div>
            </div>
          }
        }

        @for (msg of chatState.messages(); track msg.id) {
          <div class="message" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
            @if (msg.role === 'assistant') {
              <!-- Tool calls -->
              @for (tc of msg.toolCalls || []; track tc.id) {
                @if (tc.pendingConfirmation) {
                  <div class="confirm-card">
                    <p>⚠️ Execute <strong>{{ tc.toolName }}</strong>?</p>
                    <pre class="confirm-sql">{{ formatToolArgs(tc) }}</pre>
                    <div class="confirm-actions">
                      <button class="btn-confirm" (click)="chatState.confirmToolCall(tc.id, true)">Execute</button>
                      <button class="btn-cancel" (click)="chatState.confirmToolCall(tc.id, false)">Cancel</button>
                    </div>
                  </div>
                } @else {
                  <div class="tool-card" [class.expanded]="expandedTools().has(tc.id)">
                    <div class="tool-card-header" (click)="toggleTool(tc.id)">
                      <span class="tool-icon">⚡</span>
                      <span class="tool-name">{{ tc.toolName }}</span>
                      @if (tc.durationMs) {
                        <span class="tool-duration">{{ tc.durationMs }}ms</span>
                      }
                      <span class="tool-status" [class.success]="tc.success" [class.error]="!tc.success && tc.error">
                        {{ tc.success ? '✓' : (tc.error ? '✗' : '…') }}
                      </span>
                    </div>
                    @if (expandedTools().has(tc.id)) {
                      <div class="tool-card-body">
                        @if (tc.error) {
                          <div class="tool-error">{{ tc.error }}</div>
                        } @else if (tc.result) {
                          <div class="tool-result">
                            @if (isTableResult(tc.result)) {
                              <table>
                                <thead>
                                  <tr>
                                    @for (col of getResultColumns(tc.result); track col) {
                                      <th>{{ col }}</th>
                                    }
                                  </tr>
                                </thead>
                                <tbody>
                                  @for (row of getResultRows(tc.result); track $index) {
                                    <tr>
                                      @for (col of getResultColumns(tc.result); track col) {
                                        <td>{{ row[col] }}</td>
                                      }
                                    </tr>
                                  }
                                </tbody>
                              </table>
                              @if (isResultTruncated(tc.result)) {
                                <div class="tool-truncated">Showing first 50 of {{ getResultTotalRows(tc.result) }} rows</div>
                              }
                            } @else {
                              <pre>{{ tc.result | json }}</pre>
                            }
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              }
              <!-- Assistant text -->
              @if (msg.streaming) {
                <div class="message-bubble" [innerHTML]="formatMarkdown(chatState.streamingContent())"></div>
                <div class="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              } @else if (msg.content) {
                <div class="message-bubble" [innerHTML]="formatMarkdown(msg.content)"></div>
              }
            } @else {
              <div class="message-bubble">{{ msg.content }}</div>
            }
          </div>
        }
      </div>

      <!-- Input area -->
      <div class="chat-input-area">
        <textarea
          class="chat-input"
          [(ngModel)]="inputText"
          (keydown.enter)="onEnter($event)"
          placeholder="Ask about your database..."
          rows="1"
          [disabled]="chatState.streaming()"
        ></textarea>
        @if (chatState.streaming()) {
          <button class="send-btn stop" (click)="chatState.cancelStream()" title="Stop">■</button>
        } @else {
          <button class="send-btn" (click)="send()" title="Send" [disabled]="!inputText.trim()">↑</button>
        }
      </div>
    </div>
  `,
  styles: [`
    .chat-panel {
      width: 400px;
      background: var(--bg-secondary);
      border-left: 1px solid var(--border-primary);
      display: flex;
      flex-direction: column;
      transition: width 0.2s ease;
      height: 100%;
      overflow: hidden;
    }
    .chat-panel.collapsed { width: 0; min-width: 0; }

    .chat-header {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-primary);
      gap: 8px;
      flex-shrink: 0;
    }
    .chat-icon { font-size: 16px; }
    .chat-header h3 { font-size: 13px; font-weight: 600; flex: 1; margin: 0; }
    .badge {
      background: var(--accent);
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 600;
    }
    .chat-header-btn {
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 16px;
      padding: 2px;
    }
    .chat-header-btn:hover { color: var(--text-primary); }

    .new-chat-btn {
      padding: 8px 14px;
      font-size: 12px;
      cursor: pointer;
      color: var(--accent);
      display: flex;
      align-items: center;
      gap: 6px;
      border-bottom: 1px solid var(--border-primary);
      flex-shrink: 0;
    }
    .new-chat-btn:hover { background: var(--bg-hover); }

    .chat-conversations {
      border-bottom: 1px solid var(--border-primary);
      max-height: 160px;
      overflow-y: auto;
      flex-shrink: 0;
    }
    .conv-item {
      padding: 8px 14px;
      font-size: 12px;
      cursor: pointer;
      color: var(--text-secondary);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .conv-item:hover { background: var(--bg-hover); }
    .conv-item.active { background: var(--bg-active); color: var(--text-primary); }
    .conv-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .conv-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .conv-date { font-size: 10px; color: var(--text-muted); }
    .conv-delete {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 12px;
      padding: 0;
      opacity: 0;
    }
    .conv-item:hover .conv-delete { opacity: 1; }
    .conv-delete:hover { color: var(--status-error); }
    .conv-empty { padding: 12px 14px; font-size: 12px; color: var(--text-muted); text-align: center; }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .context-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--bg-tertiary);
      border-radius: 12px;
      font-size: 10px;
      color: var(--text-secondary);
      align-self: flex-start;
    }
    .ctx-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--status-success); }

    .chat-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      text-align: center;
      padding: 32px 16px;
      color: var(--text-secondary);
    }
    .chat-empty-icon { font-size: 32px; margin-bottom: 12px; }
    .chat-empty h4 { font-size: 15px; font-weight: 600; color: var(--text-primary); margin: 0 0 8px; }
    .chat-empty p { font-size: 12px; line-height: 1.5; margin: 0 0 16px; }
    .suggestions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
    .suggestion-chip {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: 12px;
      padding: 4px 12px;
      font-size: 11px;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .suggestion-chip:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--accent); }
    .setup-btn {
      background: var(--accent);
      border: none;
      color: white;
      padding: 8px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .setup-btn:hover { filter: brightness(1.1); }

    .message { display: flex; flex-direction: column; max-width: 100%; }
    .message.user { align-items: flex-end; }
    .message.assistant { align-items: flex-start; }

    .message-bubble {
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      max-width: 90%;
      word-break: break-word;
    }
    .message.user .message-bubble {
      background: var(--accent);
      color: white;
      border-bottom-right-radius: 4px;
    }
    .message.assistant .message-bubble {
      background: transparent;
      border: 1px solid var(--border-primary);
      border-bottom-left-radius: 4px;
      color: var(--text-primary);
    }

    /* Tool cards */
    .tool-card {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      margin: 4px 0;
      overflow: hidden;
      max-width: 90%;
    }
    .tool-card-header {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      gap: 8px;
      font-size: 11px;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .tool-card-header:hover { background: var(--bg-hover); }
    .tool-icon { color: var(--accent); font-size: 14px; }
    .tool-name { font-weight: 600; color: var(--text-primary); }
    .tool-duration { margin-left: auto; font-size: 10px; color: var(--text-muted); }
    .tool-status { font-size: 12px; }
    .tool-status.success { color: var(--status-success); }
    .tool-status.error { color: var(--status-error); }

    .tool-card-body {
      padding: 10px 12px;
      font-size: 12px;
      border-top: 1px solid var(--border-primary);
      overflow-x: auto;
    }
    .tool-card-body table { width: 100%; border-collapse: collapse; }
    .tool-card-body th {
      text-align: left;
      padding: 4px 8px;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border-primary);
      font-size: 11px;
      font-weight: 600;
    }
    .tool-card-body td { padding: 4px 8px; font-size: 12px; color: var(--text-primary); }
    .tool-card-body tr:hover { background: var(--bg-hover); }
    .tool-card-body pre { margin: 0; white-space: pre-wrap; font-size: 11px; color: var(--text-secondary); }
    .tool-error { color: var(--status-error); font-size: 12px; }
    .tool-truncated { font-size: 10px; color: var(--text-muted); padding-top: 4px; text-align: right; }

    /* Confirmation card */
    .confirm-card {
      background: var(--bg-tertiary);
      border: 1px solid var(--status-warning);
      border-radius: 8px;
      padding: 12px;
      margin: 4px 0;
      max-width: 90%;
    }
    .confirm-card p { font-size: 12px; margin: 0 0 8px; color: var(--text-secondary); }
    .confirm-sql {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: 4px;
      padding: 8px;
      margin: 8px 0;
      font-size: 11px;
      font-family: var(--font-mono, monospace);
      overflow-x: auto;
      white-space: pre-wrap;
      color: var(--text-primary);
    }
    .confirm-actions { display: flex; gap: 8px; }
    .btn-confirm {
      background: var(--accent);
      color: white;
      border: none;
      padding: 5px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn-confirm:hover { filter: brightness(1.1); }
    .btn-cancel {
      background: none;
      color: var(--text-secondary);
      border: 1px solid var(--border-primary);
      padding: 5px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn-cancel:hover { background: var(--bg-hover); }

    /* Typing indicator */
    .typing-indicator { display: flex; gap: 4px; padding: 4px 14px; }
    .typing-indicator span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
      animation: typing 1.4s infinite both;
    }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    /* Input area */
    .chat-input-area {
      border-top: 1px solid var(--border-primary);
      padding: 10px 14px;
      display: flex;
      gap: 8px;
      align-items: flex-end;
      flex-shrink: 0;
    }
    .chat-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 8px 12px;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 13px;
      resize: none;
      max-height: 100px;
      outline: none;
    }
    .chat-input:focus { border-color: var(--accent); }
    .chat-input::placeholder { color: var(--text-muted); }
    .chat-input:disabled { opacity: 0.6; }

    .send-btn {
      background: var(--accent);
      border: none;
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .send-btn:hover { filter: brightness(1.1); }
    .send-btn:disabled { opacity: 0.4; cursor: default; }
    .send-btn.stop { background: var(--status-error); font-size: 12px; }
  `],
})
export class ChatPanelComponent implements OnInit, AfterViewChecked {
  readonly chatState = inject(ChatStateService);
  readonly connectionState = inject(ConnectionStateService);
  readonly aiState = inject(AIStateService);
  private readonly dialog = inject(MatDialog);

  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLElement>;

  inputText = '';
  private shouldScrollToBottom = false;

  readonly expandedTools = signal(new Set<string>());

  readonly suggestions = [
    'Show me all tables',
    'Describe the schema',
    'List stored procedures',
    'Count rows in each table',
  ];

  ngOnInit(): void {
    this.chatState.initialize();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom && this.messagesContainer) {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScrollToBottom = false;
    }
  }

  onEnter(event: Event): void {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.shiftKey) return; // Allow shift+enter for newlines
    keyEvent.preventDefault();
    this.send();
  }

  send(): void {
    if (!this.inputText.trim()) return;
    this.shouldScrollToBottom = true;
    this.chatState.sendMessage(this.inputText);
    this.inputText = '';
  }

  sendSuggestion(text: string): void {
    this.shouldScrollToBottom = true;
    this.chatState.sendMessage(text);
  }

  deleteConv(event: Event, id: string): void {
    event.stopPropagation();
    this.chatState.deleteConversation(id);
  }

  toggleTool(id: string): void {
    this.expandedTools.update(set => {
      const newSet = new Set(set);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  openSetupDialog(): void {
    import('../../shared/components/ai-setup-dialog/ai-setup-dialog.component').then(mod => {
      this.dialog.open(mod.AISetupDialogComponent, {
        width: '520px',
        panelClass: 'ai-setup-dialog',
      });
    });
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  formatToolArgs(tc: ToolCallResult): string {
    if (tc.args?.['sql']) return tc.args['sql'] as string;
    return JSON.stringify(tc.args, null, 2);
  }

  formatMarkdown(text: string): string {
    if (!text) return '';
    // Simple markdown: bold, code blocks, inline code
    return text
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  isTableResult(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;
    const r = result as Record<string, unknown>;
    return Array.isArray(r['rows']) || Array.isArray(r['recordset']) || Array.isArray(result);
  }

  getResultColumns(result: unknown): string[] {
    if (!result) return [];
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['columns'])) return r['columns'] as string[];
    const rows = this.getResultRows(result);
    return rows.length > 0 ? Object.keys(rows[0]) : [];
  }

  getResultRows(result: unknown): Record<string, unknown>[] {
    if (!result) return [];
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['rows'])) return r['rows'] as Record<string, unknown>[];
    if (Array.isArray(r['recordset'])) return r['recordset'] as Record<string, unknown>[];
    return [];
  }

  isResultTruncated(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;
    return (result as Record<string, unknown>)['truncated'] === true;
  }

  getResultTotalRows(result: unknown): number {
    if (!result || typeof result !== 'object') return 0;
    return ((result as Record<string, unknown>)['rowCount'] as number) || 0;
  }
}
