# Production Roadmap - VS Code Social Presence

To move this extension from a local prototype to a production-ready application, you need to address several key areas: Backend, Security, and Distribution.

## 1. Backend Infrastructure
The current `server/index.ts` runs locally on `localhost`. Real users are on different networks.

*   **Host the WebSocket Server**: Deploy your Node.js server to a cloud provider.
    *   *Options*: Render, Railway, Heroku, AWS (EC2 or App Runner), DigitalOcean.
    *   *Action*: Update `src/wsClient.ts` to point to the production URL (e.g., `wss://api.your-extension.com`).
*   **Secure WebSockets (WSS)**: Ensure your server uses SSL/TLS (`wss://` instead of `ws://`) to encrypt data in transit. Most cloud platforms handle this automatically.
*   **Scalability**: If you have thousands of users, a single server instance might not be enough. You'd need a Redis adapter for broadcasting messages across multiple server instances.

## 2. Authentication & Identity
Currently, anyone can claim any username.

*   **Implement GitHub OAuth**: Since this is a VS Code extension, users already have GitHub accounts.
    *   Use VS Code's built-in authentication API (`vscode.authentication.getSession`).
    *   Verify the token on your WebSocket server to ensure the user is who they say they are.
*   **User IDs**: Use stable User IDs (like GitHub IDs) internally instead of mutable usernames for friend lists.

## 3. Data Persistence
*   **Friend Lists**: Currently stored in `globalState` on the client. This is fine for privacy, but means your friend list doesn't sync across your different computers.
    *   *Upgrade*: Store friend relationships in a database (PostgreSQL/MongoDB) on the server if you want cross-device sync.
*   **Offline Messages**: If you want to support "Last Seen" or offline messages, you'll need a database to store the last known state of users.

## 4. Extension Polish & Publishing
*   **Error Handling**: Improve reconnection logic in `wsClient.ts` (exponential backoff) to handle network drops gracefully.
*   **Packaging**: Use `vsce` (VS Code Extension Manager) to package your extension.
    *   Install: `npm install -g @vscode/vsce`
    *   Package: `vsce package`
*   **Marketplace Assets**:
    *   Create a high-quality icon (128x128).
    *   Write a detailed `README.md` with screenshots and usage instructions.
    *   Choose a license (e.g., MIT).
*   **Publisher Account**: Create a publisher account on the [VS Code Marketplace](https://marketplace.visualstudio.com/).

## 5. Privacy & Security Review
*   **Data Minimization**: Ensure you are only sending the data necessary.
*   **Rate Limiting**: Implement rate limiting on the server to prevent abuse.
*   **Terms of Service / Privacy Policy**: Required for the Marketplace, especially since you are handling user data (activity, project names).

## Immediate Next Step
I recommend starting with **Step 1 (Hosting)** and **Step 2 (Authentication)**. Would you like me to help you implement GitHub OAuth authentication next?
