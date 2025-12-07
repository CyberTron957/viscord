import * as vscode from 'vscode';
import { WsClient, ChatMessage } from './wsClient';

type ChatNode = ConversationNode | MessageNode | SendMessageNode;

export class ChatProvider implements vscode.TreeDataProvider<ChatNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ChatNode | undefined | null | void> = new vscode.EventEmitter<ChatNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ChatNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private wsClient: WsClient;
    private currentUsername: string = '';
    private activeChat: string | null = null;  // Username of active chat
    private messages: ChatMessage[] = [];
    private unreadCounts: Map<string, number> = new Map();

    constructor(wsClient: WsClient) {
        this.wsClient = wsClient;
    }

    setCurrentUsername(username: string) {
        this.currentUsername = username;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    // Open a chat with a specific user
    openChat(username: string) {
        this.activeChat = username;

        // Load chat history
        this.wsClient.getChatHistory(username, (messages) => {
            this.messages = messages;
            this.refresh();
        });

        // Mark as read
        this.wsClient.markChatAsRead(username);
        this.unreadCounts.delete(username);
        this.refresh();
    }

    closeChat() {
        this.activeChat = null;
        this.messages = [];
        this.refresh();
    }

    // Handle incoming message
    onMessageReceived(message: ChatMessage) {
        // If the message is from/to the active chat, add it
        if (this.activeChat === message.from_username || this.activeChat === message.to_username) {
            this.messages.push(message);
            this.refresh();
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

    getTotalUnreadCount(): number {
        let total = 0;
        for (const count of this.unreadCounts.values()) {
            total += count;
        }
        return total;
    }

    getTreeItem(element: ChatNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ChatNode): Thenable<ChatNode[]> {
        if (!element) {
            // Root level
            if (!this.activeChat) {
                // No active chat - show empty state
                const emptyNode = new vscode.TreeItem('Click a friend to start chatting', vscode.TreeItemCollapsibleState.None);
                emptyNode.iconPath = new vscode.ThemeIcon('comment');
                return Promise.resolve([emptyNode as any]);
            }

            // Show conversation header
            return Promise.resolve([
                new ConversationNode(this.activeChat)
            ]);
        }

        if (element instanceof ConversationNode) {
            // Show messages as children
            const items: ChatNode[] = this.messages.map(msg => new MessageNode(msg, this.currentUsername));

            // Add "Send Message" action at the bottom
            if (this.activeChat) {
                items.push(new SendMessageNode(this.activeChat));
            }

            return Promise.resolve(items);
        }

        return Promise.resolve([]);
    }

    // Send a message
    async sendMessage(to: string) {
        const message = await vscode.window.showInputBox({
            prompt: `Message to ${to}`,
            placeHolder: 'Type your message...',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Message cannot be empty';
                }
                if (value.length > 500) {
                    return 'Message too long (max 500 characters)';
                }
                return null;
            }
        });

        if (message) {
            this.wsClient.sendChatMessage(to, message.trim());
        }
    }
}

class ConversationNode extends vscode.TreeItem {
    constructor(public readonly username: string) {
        super(`Chat with ${username}`, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        this.contextValue = 'conversation';
    }
}

class MessageNode extends vscode.TreeItem {
    constructor(public readonly message: ChatMessage, currentUsername: string) {
        const isOwnMessage = message.from_username === currentUsername;
        const prefix = isOwnMessage ? '→ You' : `← ${message.from_username}`;

        super(`${prefix}: ${message.message}`, vscode.TreeItemCollapsibleState.None);

        // Format timestamp
        const date = new Date(message.created_at);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.description = timeStr;

        // Different icon for own vs received
        if (isOwnMessage) {
            this.iconPath = new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.blue'));
        } else {
            this.iconPath = new vscode.ThemeIcon('arrow-left', new vscode.ThemeColor('charts.green'));
        }

        this.tooltip = `${message.from_username} at ${date.toLocaleString()}\n\n${message.message}`;
        this.contextValue = 'chatMessage';
    }
}

class SendMessageNode extends vscode.TreeItem {
    constructor(public readonly toUsername: string) {
        super('Send Message...', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('pencil', new vscode.ThemeColor('charts.yellow'));
        this.command = {
            command: 'vscode-viscord.sendChatMessage',
            title: 'Send Message',
            arguments: [toUsername]
        };
        this.contextValue = 'sendMessage';
    }
}
