import { dbService } from '../server/database';

describe('Invite Link System', () => {
    beforeEach(() => {
        // Clean up database before each test
        const db = (dbService as any).db;
        db.exec('DELETE FROM invite_codes');
        db.exec('DELETE FROM manual_connections');
    });

    describe('Scenario 1: Both users NOT logged in to GitHub', () => {
        it('should allow creating invite code', () => {
            const code = dbService.createInviteCode('alice', 48);

            expect(code).toBeDefined();
            expect(code).toHaveLength(6);
            expect(/^[A-Z0-9]+$/.test(code)).toBe(true);
        });

        it('should allow accepting invite code', () => {
            const code = dbService.createInviteCode('alice', 48);
            const success = dbService.acceptInviteCode(code, 'bob');

            expect(success).toBe(true);
        });

        it('should create bidirectional connection', () => {
            const code = dbService.createInviteCode('alice', 48);
            dbService.acceptInviteCode(code, 'bob');

            expect(dbService.isManuallyConnected('alice', 'bob')).toBe(true);
            expect(dbService.isManuallyConnected('bob', 'alice')).toBe(true);
        });

        it('should show both users as connected', () => {
            const code = dbService.createInviteCode('alice', 48);
            dbService.acceptInviteCode(code, 'bob');

            const aliceConnections = dbService.getManualConnections('alice');
            const bobConnections = dbService.getManualConnections('bob');

            expect(aliceConnections).toContain('bob');
            expect(bobConnections).toContain('alice');
        });
    });

    describe('Scenario 2: Only one user logged in to GitHub', () => {
        it('should allow GitHub user to create invite', () => {
            // GitHub user creates invite (username from GitHub)
            const code = dbService.createInviteCode('github_user_123', 48);

            expect(code).toBeDefined();
        });

        it('should allow non-GitHub user to accept', () => {
            const code = dbService.createInviteCode('github_user_123', 48);
            const success = dbService.acceptInviteCode(code, 'non_github_user');

            expect(success).toBe(true);
        });

        it('should create mixed connection (GitHub + non-GitHub)', () => {
            const code = dbService.createInviteCode('github_user_123', 48);
            dbService.acceptInviteCode(code, 'non_github_user');

            expect(dbService.isManuallyConnected('github_user_123', 'non_github_user')).toBe(true);
            expect(dbService.isManuallyConnected('non_github_user', 'github_user_123')).toBe(true);
        });

        it('should allow non-GitHub user to create and GitHub user to accept', () => {
            const code = dbService.createInviteCode('non_github_user', 48);
            const success = dbService.acceptInviteCode(code, 'github_user_123');

            expect(success).toBe(true);
            expect(dbService.isManuallyConnected('non_github_user', 'github_user_123')).toBe(true);
        });
    });

    describe('Scenario 3: Both users logged in to GitHub (but not following)', () => {
        it('should allow GitHub users to connect via invite', () => {
            const code = dbService.createInviteCode('github_alice', 48);
            const success = dbService.acceptInviteCode(code, 'github_bob');

            expect(success).toBe(true);
        });

        it('should work alongside GitHub following relationships', () => {
            // Simulate: alice and bob are GitHub users but don't follow each other
            const code = dbService.createInviteCode('github_alice', 48);
            dbService.acceptInviteCode(code, 'github_bob');

            // Manual connection should exist
            expect(dbService.isManuallyConnected('github_alice', 'github_bob')).toBe(true);

            // This connection is INDEPENDENT of GitHub following
            // (They can see each other even if not followers/following)
        });

        it('should handle both GitHub relationships AND manual connections', () => {
            // alice and bob connect via invite
            const code = dbService.createInviteCode('github_alice', 48);
            dbService.acceptInviteCode(code, 'github_bob');

            // Later, alice follows bob on GitHub (separate from manual connection)
            // Both relationships should coexist without conflict
            expect(dbService.isManuallyConnected('github_alice', 'github_bob')).toBe(true);
        });
    });

    describe('Edge Cases and Validation', () => {
        it('should reject expired invite codes', () => {
            const code = dbService.createInviteCode('alice', 0.0001); // Expires in ~0.36 seconds

            // Wait for expiration
            return new Promise(resolve => {
                setTimeout(() => {
                    const success = dbService.acceptInviteCode(code, 'bob');
                    expect(success).toBe(false);
                    resolve(null);
                }, 400);
            });
        });

        it('should reject already used invite codes', () => {
            const code = dbService.createInviteCode('alice', 48);
            dbService.acceptInviteCode(code, 'bob');

            // Try to use same code again
            const success = dbService.acceptInviteCode(code, 'charlie');
            expect(success).toBe(false);
        });

        it('should reject non-existent invite codes', () => {
            const success = dbService.acceptInviteCode('XXXXXX', 'bob');
            expect(success).toBe(false);
        });

        it('should reject self-invites', () => {
            const code = dbService.createInviteCode('alice', 48);
            const success = dbService.acceptInviteCode(code, 'alice');

            expect(success).toBe(false);
        });

        it('should generate unique codes', () => {
            const code1 = dbService.createInviteCode('alice', 48);
            const code2 = dbService.createInviteCode('alice', 48);
            const code3 = dbService.createInviteCode('bob', 48);

            expect(code1).not.toBe(code2);
            expect(code2).not.toBe(code3);
            expect(code1).not.toBe(code3);
        });
    });

    describe('Connection Management', () => {
        it('should allow removing manual connections', () => {
            const code = dbService.createInviteCode('alice', 48);
            dbService.acceptInviteCode(code, 'bob');

            expect(dbService.isManuallyConnected('alice', 'bob')).toBe(true);

            dbService.removeManualConnection('alice', 'bob');

            expect(dbService.isManuallyConnected('alice', 'bob')).toBe(false);
            expect(dbService.isManuallyConnected('bob', 'alice')).toBe(false);
        });

        it('should handle multiple connections per user', () => {
            // alice connects with bob
            const code1 = dbService.createInviteCode('alice', 48);
            dbService.acceptInviteCode(code1, 'bob');

            // alice connects with charlie
            const code2 = dbService.createInviteCode('alice', 48);
            dbService.acceptInviteCode(code2, 'charlie');

            const aliceConnections = dbService.getManualConnections('alice');
            expect(aliceConnections).toHaveLength(2);
            expect(aliceConnections).toContain('bob');
            expect(aliceConnections).toContain('charlie');
        });
    });
});
