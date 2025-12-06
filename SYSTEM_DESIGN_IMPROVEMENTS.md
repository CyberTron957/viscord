# System Design Improvements: Robustness & Efficiency

The current architecture relies on a **Global Broadcast Model** where the server holds all state in-memory and re-calculates visibility for every user whenever *anything* changes. This is $O(N^2)$ complexity and creates a single point of failure.

Below is a proposed architecture for a production-grade, scalable system.

## 1. Architecture: From Polling to Pub/Sub

### Current Bottleneck
Currently, `broadcastUpdate()` iterates through ALL clients for EVERY connected client.
- **Complexity**: $O(N^2)$
- **Payload**: Sends full user list every 2 seconds. bandwidth heavy.
- **State**: In-memory `clients` Map. If server restarts, everyone disconnects and online state is lost until reconnection.

### Proposed Solution: Redis Pub/Sub + Delta Updates

Instead of broadcasting the world state, we treat the system as a **Subscription Model**.

1.  **Shared State (Redis)**:
    *   Use Redis to store **Sessions** and **Online Status**.
    *   Use `SET user:123:status "coding" EX 30` (Expires in 30s) for presence.
    *   Clients send "Heartbeats" every 10s to refresh the TTL. If server crashes, Redis keeps the state.

2.  **Channel Subscription**:
    *   When User A connects, they subscribe to a Redis channel: `user:A:inbox`.
    *   Server calculates who User A follows (User B, C, D).
    *   Server subscribes User A to `presence:B`, `presence:C`, `presence:D`.

3.  **Delta Updates (The Efficiency Win)**:
    *   User B changes status to "Debugging".
    *   Server publishes event `{"type": "status_change", "user": "B", "status": "Debugging"}` to channel `presence:B`.
    *   Redis fans this out ONLY to people listening to B (User A).
    *   **Complexity**: $O(1)$ for the sender, $O(K)$ where K is follower count.

## 2. Protocol Optimization

### Current Protocol
JSON payloads are verbose.
```json
{ "type": "userList", "users": [{...}, {...}, {...}] } // Repeated constantly
```

### Proposed Protocol (Event-Driven)
Clients maintain their own local state Map. Server sends **patches**.

1.  **Initial State**: On connect, send `SYNC` with relevant friends only.
2.  **Updates**:
    ```json
    { "t": "u", "id": "github_123", "s": "coding", "p": "vscode" }
    ```
    *   `t`: type (update)
    *   `s`: status
    *   `p`: project
    *   Short keys save bandwidth.

3.  **Binary Protocol (Optional)**:
    *   Use **Protobuf** or **MessagePack** instead of JSON for WebSocket messages to reduce payload size by ~60%.

## 3. Database Strategy: Read vs Write

### Current Issues
*   SQLite queries happen inside the broadcast loop (checking manual connections, close friends).
*   Writes (last_seen) happen on every disconnect.

### Proposed Strategy
1.  **Read-Through Cache**:
    *   Keep "Friend Lists" and "Manual Connections" associated with a session in Redis.
    *   `HGET sessions:socket_id "friends_list"` -> Returns cached list of IDs to notify.

2.  **Write-Behind**:
    *   Status updates go to Redis only (fast).
    *   Persist "Last Seen" to SQLite/Postgres only once every 5-10 minutes via a background worker, or only on definitive session end.

## 4. Connection Robustness

### Heartbeats & Tombstones
*   **Problem**: TCP dead connections (half-open) might not be detected for minutes.
*   **Fix**: Application-level Ping/Pong every 30s.
    *   Server sends `PING`. Client must reply `PONG`.
    *   If missed 2 PONGs, server kills connection and notifies friends "Offline".

### Graceful Reconnection
*   **Session Resumption**:
    *   Give clients a `resume_token`.
    *   If WebSocket drops and reconnects within 60s, client sends `resume_token`.
    *   Server re-binds the socket to the existing Redis session without triggering "User Offline" -> "User Online" flap notifications to all friends.

## 5. Scalability (Horizontal)

With the Local Map approach, you are stuck on one server. With Redis Pub/Sub:
*   You can run 10 server instances behind a Load Balancer (Nginx/Caddy).
*   User A connects to Server 1.
*   User B connects to Server 2.
*   User A updates status -> Server 1 publishes to Redis -> Redis notifies Server 2 -> Server 2 sends to User B.

## Summary of Changes

| Feature | Current | Proposed | Benefit |
| :--- | :--- | :--- | :--- |
| **State** | Local Memory | Redis Store | Persists across restarts, allows scaling |
| **Updates** | Global Broadcast $O(N^2)$ | Pub/Sub Delta $O(K)$ | Massive CPU/Network reduction |
| **Connection** | Basic WS | WS + Heartbeat + Resume | No "flapping" online/offline |
| **Payload** | Full User List | JSON Patch / MsgPack | 90% Bandwidth saving |
