/**
 * AI Chat Panel - Slide-out panel for AI assistant conversations
 */

import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  ChangeDetectionStrategy,
  HostListener,
  Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MarkdownModule } from '@memberjunction/ng-markdown';
import { ChatStateService } from '../../core/state/chat.state';
import { ChatInstanceState } from '../../core/state/chat-instance.state';
import { ConnectionStateService } from '../../core/state/connection.state';
import { AIStateService } from '../../core/state/ai.state';
import { TabStateService } from '../../core/state/tab.state';
import { IpcService } from '../../core/services/ipc.service';
import { firstValueFrom } from 'rxjs';
import type { ToolCallResult } from '@mj-forge/shared';

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chat-panel"
         [class.collapsed]="!isTabMode && !chatState.panelOpen()"
         [class.tab-mode]="isTabMode"
         [style.width.px]="isTabMode ? null : panelWidth()">
      <!-- Resize handle (side panel mode only) -->
      @if (!isTabMode) {
        <div class="resize-handle"
             (mousedown)="onResizeStart($event)">
        </div>
      }
      <!-- Header -->
      <div class="chat-header">
        <span class="chat-icon">✨</span>
        <h3>AI Assistant</h3>
        <span class="badge">AI</span>
        <button class="chat-header-btn" (click)="state.toggleConversations()" title="Conversations">☰</button>
        @if (!isTabMode) {
          <button class="chat-header-btn" (click)="popOutToTab()" title="Open as tab">⧉</button>
        }
        @if (!isTabMode) {
          <button class="chat-header-btn" (click)="chatState.closePanel()" title="Close">✕</button>
        }
      </div>

      <!-- New Chat button -->
      <div class="new-chat-btn" (click)="state.newConversation()">+ New Chat</div>

      <!-- Conversation list -->
      @if (state.conversationsExpanded()) {
        <div class="chat-conversations">
          @for (conv of state.conversations(); track conv.id) {
            <div class="conv-item"
                 [class.active]="conv.id === state.activeConversationId()"
                 (click)="state.selectConversation(conv.id)">
              <span class="conv-title">{{ conv.title }}</span>
              <div class="conv-actions">
                <span class="conv-date">{{ formatDate(conv.updatedAt) }}</span>
                <button class="conv-delete" (click)="deleteConv($event, conv.id)" title="Delete">✕</button>
              </div>
            </div>
          }
          @if (!state.hasConversations()) {
            <div class="conv-empty">No conversations yet</div>
          }
        </div>
      }

      <!-- Messages area -->
      <div class="chat-messages-wrapper">
      <div class="chat-messages" #messagesContainer (scroll)="onMessagesScroll()">
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

        @if (!state.activeConversationId() && !state.streaming()) {
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

        @for (msg of state.messages(); track msg.id) {
          <div class="message" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
            @if (msg.role === 'assistant') {
              <!-- Tool calls -->
              @for (tc of msg.toolCalls || []; track tc.id) {
                @if (tc.pendingConfirmation) {
                  <div class="confirm-card">
                    <p>⚠️ Execute <strong>{{ tc.toolName }}</strong>?</p>
                    <pre class="confirm-sql">{{ formatToolArgs(tc) }}</pre>
                    <div class="confirm-actions">
                      <button class="btn-confirm" (click)="state.confirmToolCall(tc.id, true)">Execute</button>
                      <button class="btn-cancel" (click)="state.confirmToolCall(tc.id, false)">Cancel</button>
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
                @if (state.streamingContent()) {
                  <div class="message-bubble streaming-bubble">
                    <mj-markdown [data]="state.streamingContent()" [enableMermaid]="false" [enableCodeCopy]="false" [mermaidTheme]="'dark'" containerClass="chat-md"></mj-markdown>
                  </div>
                }
                <div class="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              } @else if (msg.content) {
                <div class="message-bubble">
                  <mj-markdown [data]="msg.content" [enableMermaid]="true" [enableCodeCopy]="true" [mermaidTheme]="'dark'" containerClass="chat-md"></mj-markdown>
                </div>
              }
            } @else {
              <div class="message-bubble">{{ msg.content }}</div>
            }
          </div>
        }
      </div>
      @if (showScrollToBottom()) {
        <button class="scroll-to-bottom" (click)="scrollToBottom()" title="Jump to bottom">↓</button>
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
          [disabled]="state.streaming()"
        ></textarea>
        @if (state.streaming()) {
          <button class="send-btn stop" (click)="state.cancelStream()" title="Stop">■</button>
        } @else {
          <button class="send-btn" (click)="send()" title="Send" [disabled]="!inputText.trim()">↑</button>
        }
      </div>
    </div>
  `,
  styles: [`
    .chat-panel {
      background: var(--bg-secondary);
      border-left: 1px solid var(--border-primary);
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      position: relative;
      min-width: 280px;
      max-width: 800px;
    }
    .chat-panel:not(.tab-mode) { transition: width 0.15s ease; }
    .chat-panel.collapsed { width: 0 !important; min-width: 0; border-left: none; }
    .chat-panel.tab-mode { width: 100% !important; max-width: none; min-width: 0; border-left: none; }

    .resize-handle {
      position: absolute;
      left: 0;
      top: 0;
      width: 4px;
      height: 100%;
      cursor: col-resize;
      z-index: 10;
      background: transparent;
    }
    .resize-handle:hover,
    .resize-handle:active {
      background: var(--accent);
      opacity: 0.5;
    }

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

    .chat-messages-wrapper {
      flex: 1;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .scroll-to-bottom {
      position: absolute;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-elevated);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      box-shadow: var(--shadow-md, 0 2px 8px rgba(0,0,0,0.15));
      z-index: 5;
      transition: opacity 0.15s ease;
    }
    .scroll-to-bottom:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
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

    /* Markdown rendering in chat bubbles */
    :host ::ng-deep .chat-md {
      font-size: 13px;
      line-height: 1.6;
      color: inherit;
    }
    :host ::ng-deep .chat-md p { margin: 0 0 8px; }
    :host ::ng-deep .chat-md p:last-child { margin-bottom: 0; }
    :host ::ng-deep .chat-md pre {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      padding: 10px 12px;
      overflow-x: auto;
      font-size: 12px;
      margin: 8px 0;
      color: var(--text-primary);
    }
    :host ::ng-deep .chat-md code {
      font-family: var(--font-mono, 'SF Mono', 'Fira Code', monospace);
      font-size: 12px;
      color: var(--text-primary);
    }
    :host ::ng-deep .chat-md :not(pre) > code {
      background: rgba(255, 255, 255, 0.08);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 0.9em;
      color: var(--text-primary);
    }
    :host ::ng-deep .chat-md ul, :host ::ng-deep .chat-md ol {
      margin: 4px 0;
      padding-left: 20px;
    }
    :host ::ng-deep .chat-md li { margin: 2px 0; }
    :host ::ng-deep .chat-md h1, :host ::ng-deep .chat-md h2,
    :host ::ng-deep .chat-md h3, :host ::ng-deep .chat-md h4 {
      font-size: 13px;
      font-weight: 600;
      margin: 12px 0 4px;
    }
    :host ::ng-deep .chat-md h1 { font-size: 15px; }
    :host ::ng-deep .chat-md h2 { font-size: 14px; }
    :host ::ng-deep .chat-md table {
      border-collapse: collapse;
      width: 100%;
      margin: 8px 0;
      font-size: 12px;
    }
    :host ::ng-deep .chat-md th, :host ::ng-deep .chat-md td {
      border: 1px solid var(--border-primary);
      padding: 4px 8px;
      text-align: left;
      color: var(--text-primary);
    }
    :host ::ng-deep .chat-md th {
      background: var(--bg-tertiary);
      font-weight: 600;
      color: var(--text-secondary);
    }
    :host ::ng-deep .chat-md tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.03);
    }
    :host ::ng-deep .chat-md tr:nth-child(odd) {
      background: transparent;
    }
    :host ::ng-deep .chat-md tr:hover {
      background: var(--bg-hover);
    }
    :host ::ng-deep .chat-md blockquote {
      border-left: 3px solid var(--accent);
      padding-left: 12px;
      margin: 8px 0;
      color: var(--text-secondary);
    }
    :host ::ng-deep .chat-md .mermaid { margin: 8px 0; }
    .streaming-bubble :host ::ng-deep .chat-md pre { margin: 4px 0; }
  `],
})
export class ChatPanelComponent implements OnInit, OnDestroy, AfterViewChecked {
  readonly chatState = inject(ChatStateService);
  readonly connectionState = inject(ConnectionStateService);
  readonly aiState = inject(AIStateService);
  private readonly tabState = inject(TabStateService);
  private readonly ipc = inject(IpcService);
  private readonly dialog = inject(MatDialog);

  /** When true, renders in tab mode (no side panel chrome) */
  @Input() isTabMode = false;

  /** Optional initial conversation ID for tab mode */
  @Input() conversationId?: string;

  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLElement>;

  inputText = '';

  readonly expandedTools = signal(new Set<string>());
  readonly panelWidth = signal(400);

  // Smart auto-scroll state
  readonly showScrollToBottom = signal(false);
  private userScrolledUp = false;
  private autoScrollEnabled = true;

  // Per-instance state for tab mode
  private instanceState: ChatInstanceState | null = null;

  /**
   * Unified state accessor — in tab mode uses independent instance state,
   * in side panel mode uses the singleton ChatStateService.
   */
  get state(): ChatStateService | ChatInstanceState {
    return this.instanceState ?? this.chatState;
  }

  // Resize state
  private resizing = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;

  readonly suggestions = [
    'Show me all tables',
    'Describe the schema',
    'List stored procedures',
    'Count rows in each table',
  ];

  ngOnInit(): void {
    if (this.isTabMode) {
      // Create independent instance state for this tab
      this.instanceState = new ChatInstanceState(
        this.ipc,
        this.connectionState,
        this.tabState,
        this.conversationId,
      );
      this.instanceState.initialize();
    } else {
      this.chatState.initialize();
    }
    this.loadSavedWidth();
  }

  ngOnDestroy(): void {
    this.instanceState?.destroy();
  }

  private async loadSavedWidth(): Promise<void> {
    if (!this.ipc.isAvailable) return;
    try {
      const state = await firstValueFrom(this.ipc.getAppState());
      if (state?.chatPanelWidth && state.chatPanelWidth >= 280) {
        this.panelWidth.set(state.chatPanelWidth);
      }
    } catch { /* use default */ }
  }

  private saveWidth(): void {
    if (!this.ipc.isAvailable) return;
    firstValueFrom(this.ipc.setAppState({ chatPanelWidth: this.panelWidth() })).catch(() => {});
  }

  onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    this.resizing = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.panelWidth();
  }

  @HostListener('document:mousemove', ['$event'])
  onResizeMove(event: MouseEvent): void {
    if (!this.resizing) return;
    // Panel is on the right, so dragging left increases width
    const delta = this.resizeStartX - event.clientX;
    const newWidth = Math.max(280, Math.min(800, this.resizeStartWidth + delta));
    this.panelWidth.set(newWidth);
  }

  @HostListener('document:mouseup')
  onResizeEnd(): void {
    if (!this.resizing) return;
    this.resizing = false;
    this.saveWidth();
  }

  popOutToTab(): void {
    this.chatState.closePanel();
    this.tabState.openChatTab(this.state.activeConversationId() || undefined);
  }

  ngAfterViewChecked(): void {
    if (this.autoScrollEnabled && !this.userScrolledUp && this.messagesContainer) {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  onMessagesScroll(): void {
    if (!this.messagesContainer) return;
    const el = this.messagesContainer.nativeElement;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;

    if (atBottom) {
      this.userScrolledUp = false;
      this.showScrollToBottom.set(false);
    } else if (this.state.streaming()) {
      // User scrolled up during streaming
      this.userScrolledUp = true;
      this.showScrollToBottom.set(true);
    }
  }

  scrollToBottom(): void {
    if (!this.messagesContainer) return;
    const el = this.messagesContainer.nativeElement;
    el.scrollTop = el.scrollHeight;
    this.userScrolledUp = false;
    this.showScrollToBottom.set(false);
  }

  onEnter(event: Event): void {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.shiftKey) return; // Allow shift+enter for newlines
    keyEvent.preventDefault();
    this.send();
  }

  send(): void {
    if (!this.inputText.trim()) return;
    this.userScrolledUp = false;
    this.showScrollToBottom.set(false);
    this.autoScrollEnabled = true;
    this.state.sendMessage(this.inputText);
    this.inputText = '';
  }

  sendSuggestion(text: string): void {
    this.userScrolledUp = false;
    this.showScrollToBottom.set(false);
    this.autoScrollEnabled = true;
    this.state.sendMessage(text);
  }

  deleteConv(event: Event, id: string): void {
    event.stopPropagation();
    this.state.deleteConversation(id);
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
