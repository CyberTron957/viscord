# Edge Cases Handling

This document outlines how the VS Code Social Presence extension handles various edge cases, particularly regarding authentication and connectivity.

## 1. Mixed Authentication Scenarios

### Scenario: GitHub User connecting with Non-GitHub (Guest) User
**Context:** A user logged in via GitHub wants to connect with a user who doesn't have a GitHub account (or chose not to log in).
**Handling:**
- **Invite Links:** The primary mechanism for this connection.
- **GitHub User:** Creates an invite link.
- **Guest User:** Accepts the invite link using their local username.
- **Result:** A bidirectional "manual connection" is created in the database.
- **Visibility:** The server checks `manual_connections` table. If a connection exists, they can see each other regardless of GitHub follower status.

### Scenario: Two GitHub Users (Not Following Each Other)
**Context:** Two users are logged in with GitHub but don't follow each other on GitHub.
**Handling:**
- **Invite Links:** They can use an invite link to connect.
- **Result:** A "manual connection" is created.
- **Visibility:** The visibility logic checks: `isManuallyConnected || isGitHubFollower`. Since `isManuallyConnected` is true, they will see each other.

## 2. Guest Mode (No GitHub Login)

### Scenario: User skips GitHub Login
**Context:** User cancels the GitHub authentication prompt or it fails.
**Handling:**
- **Prompt:** The extension prompts for a local "Guest Username".
- **Storage:** This username is stored in VS Code global configuration (`vscode-social-presence.username`).
- **Functionality:**
    - Can create invite links.
    - Can accept invite links.
    - **Limitation:** Cannot see GitHub followers/following (obviously).
    - **Persistence:** Friend connections are stored in the `manual_connections` table linked to their guest username.

## 3. Multiple Windows (Session Management)

### Scenario: User opens multiple VS Code windows
**Context:** A user works on multiple projects simultaneously.
**Handling:**
- **Session IDs:** Each window generates a unique `sessionId`.
- **Aggregation:** The server groups all connections with the same `username`.
- **Status Priority:** The server calculates a single "Display Status" based on priority:
    1. **Debugging** (Highest)
    2. **Coding**
    3. **Reading**
    4. **Idle** (Lowest)
- **Result:** Friends see a single entry for the user with their most active status.

## 4. Offline Users

### Scenario: User disconnects
**Context:** User closes VS Code or loses internet.
**Handling:**
- **Database:** The server updates the `last_seen` timestamp in the `users` table.
- **Display:** Friends (followers/manual connections) see the user as "Offline" with a relative timestamp (e.g., "Last seen 5m ago").
- **Cleanup:** Users offline for more than 7 days are filtered out from the view to keep the list clean.

## 5. Duplicate Usernames (Guest Mode)

### Scenario: Guest chooses a username that matches a GitHub user
**Context:** Guest picks "octocat" but isn't the real Octocat.
**Handling:**
- **Current Limitation:** The system relies on unique usernames. If a guest picks a username that matches a real GitHub user, they might inadvertently "claim" that identity within the context of manual connections.
- **Mitigation:** Invite links are secure. You only connect with someone if you explicitly accept their invite. You won't automatically see their GitHub followers.
- **Future Improvement:** Namespace guest users (e.g., `guest:username`) or enforce unique reservation.

