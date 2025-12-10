import * as vscode from 'vscode';
import { WsClient, ChatMessage } from './wsClient';

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'viscord-chat';

    private _view?: vscode.WebviewView;
    private wsClient: WsClient;
    private currentUsername: string = '';
    private activeChat: string | null = null;
    private messages: ChatMessage[] = [];
    private unreadCounts: Map<string, number> = new Map();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        wsClient: WsClient
    ) {
        this.wsClient = wsClient;
    }

    setCurrentUsername(username: string) {
        this.currentUsername = username;
        this._updateWebview();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'sendMessage':
                    if (this.activeChat && data.message) {
                        this.wsClient.sendChatMessage(this.activeChat, data.message);
                    }
                    break;
                case 'closeChat':
                    this.closeChat();
                    break;
            }
        });
    }

    // Open a chat with a specific user
    openChat(username: string) {
        this.activeChat = username;
        this.messages = [];

        // Load chat history
        this.wsClient.getChatHistory(username, (messages) => {
            this.messages = messages;
            this._updateWebview();
        });

        // Mark as read
        this.wsClient.markChatAsRead(username);
        this.unreadCounts.delete(username);
        this._updateWebview();
    }

    closeChat() {
        this.activeChat = null;
        this.messages = [];
        this._updateWebview();
    }

    // Check if currently chatting with a specific user
    isActiveChatWith(username: string): boolean {
        return this.activeChat === username;
    }

    // Handle incoming message
    onMessageReceived(message: ChatMessage) {
        // If the message is from/to the active chat, add it
        if (this.activeChat === message.from_username || this.activeChat === message.to_username) {
            this.messages.push(message);
            this._updateWebview();
        }

        // Update unread count if message is from someone else and not in active chat
        if (message.from_username !== this.currentUsername && this.activeChat !== message.from_username) {
            const count = this.unreadCounts.get(message.from_username) || 0;
            this.unreadCounts.set(message.from_username, count + 1);
        }
    }

    getUnreadCount(username: string): number {
        return this.unreadCounts.get(username) || 0;
    }

    private _updateWebview() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'update',
                activeChat: this.activeChat,
                messages: this.messages,
                currentUsername: this.currentUsername
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .no-chat {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
        
        .no-chat-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }
        
        .chat-container {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        
        .chat-header {
            padding: 12px 16px;
            background: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .chat-header-title {
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .close-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            opacity: 0.7;
        }
        
        .close-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
            opacity: 1;
        }
        
        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .message {
            max-width: 85%;
            padding: 8px 12px;
            border-radius: 12px;
            word-wrap: break-word;
        }
        
        .message-sent {
            align-self: flex-end;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-bottom-right-radius: 4px;
        }
        
        .message-received {
            align-self: flex-start;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-bottom-left-radius: 4px;
        }
        
        .message-time {
            font-size: 10px;
            opacity: 0.6;
            margin-top: 4px;
        }
        
        .message-sent .message-time {
            text-align: right;
        }
        
        .input-container {
            padding: 12px;
            background: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
            display: flex;
            gap: 8px;
        }
        
        .message-input {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 18px;
            outline: none;
            font-family: inherit;
            font-size: inherit;
        }
        
        .message-input:focus {
            border-color: var(--vscode-focusBorder);
        }
        
        .message-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        
        .send-btn {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 18px;
            cursor: pointer;
            font-weight: 500;
        }
        
        .send-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .empty-messages {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            padding: 40px 20px;
        }
    </style>
</head>
<body>
    <div id="app">
        <div class="no-chat" id="no-chat">
            <div class="no-chat-icon">💬</div>
            <div>Click the chat icon on a friend<br>to start a conversation</div>
        </div>
        
        <div class="chat-container" id="chat-container" style="display: none;">
            <div class="chat-header">
                <div class="chat-header-title">
                    <span>💬</span>
                    <span id="chat-with"></span>
                </div>
                <button class="close-btn" onclick="closeChat()">✕</button>
            </div>
            
            <div class="messages-container" id="messages">
                <div class="empty-messages">No messages yet. Say hello! 👋</div>
            </div>
            
            <div class="input-container">
                <input 
                    type="text" 
                    class="message-input" 
                    id="message-input" 
                    placeholder="Type a message..."
                    maxlength="500"
                    onkeypress="handleKeyPress(event)"
                />
                <button class="send-btn" onclick="sendMessage()">Send</button>
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let currentUsername = '';
        let activeChat = null;
        
        // Handle messages from the extension
        window.addEventListener('message', event => {
            const data = event.data;
            
            if (data.type === 'update') {
                currentUsername = data.currentUsername;
                activeChat = data.activeChat;
                
                if (activeChat) {
                    document.getElementById('no-chat').style.display = 'none';
                    document.getElementById('chat-container').style.display = 'flex';
                    document.getElementById('chat-with').textContent = activeChat;
                    renderMessages(data.messages);
                } else {
                    document.getElementById('no-chat').style.display = 'flex';
                    document.getElementById('chat-container').style.display = 'none';
                }
            }
        });
        
        function renderMessages(messages) {
            const container = document.getElementById('messages');
            
            if (!messages || messages.length === 0) {
                container.innerHTML = '<div class="empty-messages">No messages yet. Say hello! 👋</div>';
                return;
            }
            
            container.innerHTML = messages.map(msg => {
                const isSent = msg.from_username === currentUsername;
                const time = new Date(msg.created_at).toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
                
                return \`
                    <div class="message \${isSent ? 'message-sent' : 'message-received'}">
                        <div class="message-text">\${escapeHtml(msg.message)}</div>
                        <div class="message-time">\${time}</div>
                    </div>
                \`;
            }).join('');
            
            // Scroll to bottom after DOM update
            requestAnimationFrame(() => {
                container.scrollTop = container.scrollHeight;
            });
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function sendMessage() {
            const input = document.getElementById('message-input');
            const message = input.value.trim();
            
            if (message && activeChat) {
                vscode.postMessage({
                    type: 'sendMessage',
                    message: message
                });
                input.value = '';
                input.focus();
            }
        }
        
        function handleKeyPress(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        }
        
        function closeChat() {
            vscode.postMessage({ type: 'closeChat' });
        }
    </script>
</body>
</html>`;
    }
}
