# Invite Link Feature - User Guide

## 🎯 What is the Invite Link Feature?

The invite link feature allows you to connect with friends **without GitHub**. This is perfect for:
- Users who don't want to log in with GitHub
- Connecting with people who aren't your GitHub followers/following
- Quick, temporary connections

## 🔗 How to Use

### Creating an Invite Link

1. **Open Social Presence panel** in VS Code sidebar
2. **Click the link icon** (🔗) in the panel toolbar
   - Or run command: `Create Invite Link`
3. You'll get a **6-character invite code** (e.g., `ABC123`)
4. **Copy the code** and share it with your friend
5. Code **expires in 48 hours**

### Accepting an Invite

1. Get an invite code from a friend
2. Run command: `Accept Invite Code` (`Cmd+Shift+P` → type "Accept Invite")
3. Enter the 6-character code
4. You're now connected! Both users will see each other in their friend list

## 📱 Example Flow

**User A wants to connect with User B:**

```
User A:
1. Clicks "Create Invite Link" button
2. Gets code: "XYZ789"
3. Shares code with User B via Slack/Discord/Email

User B:
1. Runs "Accept Invite Code" command
2. Enters: "XYZ789"
3. ✅ Connected!

Result:
- User A sees "User B is now online!"
- User B sees "Successfully connected with User A!"
- Both see each other in sidebar (even if not GitHub friends)
```

## 🔒 Security & Privacy

- **One-time use**: Each code can only be used once
- **Expires**: Codes expire after 48 hours
- **Bidirectional**: Connection works both ways automatically
- **Revocable**: You can remove manual connections anytime

## ⚙️ Technical Details

### Database Schema
```sql
CREATE TABLE invite_codes (
  code TEXT PRIMARY KEY,           -- 6-char code (e.g., ABC123)
  creator_username TEXT NOT NULL,  -- Who created it
  created_at INTEGER,              -- Unix timestamp
  expires_at INTEGER,              -- Expiration time
  used_by TEXT,                    -- Who accepted (if used)
  used_at INTEGER                  -- When it was used
);

CREATE TABLE manual_connections (
  user1_username TEXT NOT NULL,
  user2_username TEXT NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (user1_username, user2_username)
);
```

### WebSocket Messages

**Create Invite:**
```json
// Client → Server
{ "type": "createInvite" }

// Server → Client
{
  "type": "inviteCreated",
  "code": "ABC123",
  "expiresIn": "48 hours"
}
```

**Accept Invite:**
```json
// Client → Server
{
  "type": "acceptInvite",
  "code": "ABC123"
}

// Server → Client (success)
{
  "type": "inviteAccepted",
  "success": true,
  "friendUsername": "alice"
}

// Server → Creator (notification)
{
  "type": "friendJoined",
  "user": { "username": "bob", "avatar": "..." },
  "via": "invite"
}
```

## 🎨 UI Elements

- **Toolbar button**: Link icon (🔗) in Social Presence panel
- **Commands**:
  - `Create Invite Link` - Generate new invite code
  - `Accept Invite Code` - Accept someone's invite
- **Notifications**:
  - Invite created: Shows code with "Copy Code" button
  - Invite accepted: Shows success message  
  - Friend joined: Shows when invitee comes online

## 🐛 Error Handling

Invite can fail if:
- Code doesn't exist
- Code already used
- Code expired (>48 hours)
- Trying to accept your own invite

Error message shown: `"Invalid, expired, or already used invite code"`

## 🚀 Future Enhancements

Potential additions:
- Custom expiration times
- Invite link URLs (instead of just codes)
- Group invites (invite multiple people with one code)
- Invite usage analytics
- Nickname support for manual connections
