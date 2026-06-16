/**
 * 认证中间件 - JWT with backward compatibility
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * P2 CONFIG CLEANUP: no hardcoded secret. Production requires JWT_SECRET;
 * dev generates an ephemeral per-startup secret (never a published constant).
 */
function resolveJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (value) return value;

  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET environment variable must be set in production');
    process.exit(1);
  }

  const generated = crypto.randomBytes(48).toString('base64url');
  console.warn(`⚠️  [DEV] JWT_SECRET not set — generated ephemeral secret (valid for this process only).`);
  return generated;
}

const JWT_SECRET = resolveJwtSecret();

export interface UserRole {
  role: 'admin' | 'viewer';
}

export interface AuthConfig {
  agentTokens: Set<string>;
  adminTokens: Set<string>;
}

export class AuthService {
  private agentTokens: Set<string>;
  private adminTokens: Set<string>;

  constructor(config: AuthConfig) {
    this.agentTokens = config.agentTokens;
    this.adminTokens = config.adminTokens;
  }

  // JWT Token Generation
  generateAgentToken(deviceId: string): string {
    return jwt.sign(
      { type: 'agent', deviceId },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  generateAdminToken(username: string, role: 'admin' | 'viewer' = 'admin'): string {
    return jwt.sign(
      { type: 'admin', username, role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
  }

  // JWT Token Verification
  verifyJWT(token: string): jwt.JwtPayload | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
      return decoded;
    } catch (err) {
      return null;
    }
  }


  // Verify Agent Token (JWT or legacy)
  verifyAgentToken(token: string): boolean {
    // First try JWT verification
    const jwtPayload = this.verifyJWT(token);
    if (jwtPayload && jwtPayload.type === 'agent') {
      return true;
    }

    // Fallback to legacy static token check
    return this.agentTokens.has(token);
  }

  // Verify token and return role — use this for HTTP API authorization
  verifyWebRequest(token: string): 'admin' | 'viewer' | null {
    const jwtPayload = this.verifyJWT(token);
    if (jwtPayload && (jwtPayload.type === 'admin' || jwtPayload.type === 'web')) {
      return (jwtPayload.role as 'admin' | 'viewer') || 'admin';
    }
    // Legacy static token = admin access
    if (this.adminTokens.has(token)) return 'admin';
    return null;
  }

  // Verify Admin Token (JWT admin role only, NOT viewer)
  verifyAdminToken(token: string): boolean {
    const jwtPayload = this.verifyJWT(token);
    if (jwtPayload && jwtPayload.type === 'admin' && jwtPayload.role === 'admin') {
      return true;
    }
    // Legacy static token = admin
    return this.adminTokens.has(token);
  }

  // Get User Role from JWT token
  getUserRole(token: string): 'admin' | 'viewer' | null {
    const jwtPayload = this.verifyJWT(token);
    if (jwtPayload && jwtPayload.type === 'admin' && jwtPayload.role) {
      return jwtPayload.role as 'admin' | 'viewer';
    }
    return null;
  }

  // Check if user has admin access (not just viewer)
  hasAdminAccess(token: string): boolean {
    const role = this.getUserRole(token);
    if (role === 'admin') {
      return true;
    }

    // Fallback to legacy token check
    return this.adminTokens.has(token);
  }

  // ========== P0 SECURITY: Channel Separation ==========

  /**
   * Verify agent connection - ONLY agent tokens can connect to agent channel
   * Returns connection info if valid, null if invalid
   */
  verifyAgentConnection(token: string, deviceId: string): { deviceId: string } | null {
    // First try JWT verification
    const jwtPayload = this.verifyJWT(token);
    if (jwtPayload && jwtPayload.type === 'agent' && jwtPayload.deviceId) {
      return { deviceId: jwtPayload.deviceId };
    }

    // Fallback to legacy static token check (deviceId must be provided separately)
    if (this.agentTokens.has(token) && deviceId) {
      return { deviceId };
    }

    return null;
  }

  /**
   * Verify web connection - ONLY admin/viewer tokens can connect to web channel
   * Returns user role if valid, null if invalid
   */
  verifyWebConnection(token: string): 'admin' | 'viewer' | null {
    // First try JWT verification
    const jwtPayload = this.verifyJWT(token);
    if (jwtPayload && jwtPayload.type === 'admin' && jwtPayload.role) {
      return jwtPayload.role as 'admin' | 'viewer';
    }

    // Fallback to legacy token check (legacy tokens are admin-only)
    if (this.adminTokens.has(token)) {
      return 'admin';
    }

    return null;
  }

  /**
   * P0 SECURITY: Command authorization by role
   * Viewers CANNOT send dangerous commands
   */
  authorizeCommand(role: 'admin' | 'viewer', commandType: string): boolean {
    // Viewers can ONLY send these read-only commands
    const viewerAllowedCommands = new Set([
      'cmd:screenshot',
      'cmd:getInfo',
      'cmd:getDOM',
      'cmd:getCookies',
      'cmd:getStorage',
      'cmd:subscribeNetwork',
      'cmd:subscribeConsole',
    ]);

    if (role === 'viewer') {
      return viewerAllowedCommands.has(commandType);
    }

    // Admin can send all commands
    return true;
  }

  // Legacy Token Management (backward compatibility)
  addAgentToken(token: string): void {
    this.agentTokens.add(token);
  }

  removeAgentToken(token: string): void {
    this.agentTokens.delete(token);
  }

  addAdminToken(token: string): void {
    this.adminTokens.add(token);
  }

  removeAdminToken(token: string): void {
    this.adminTokens.delete(token);
  }
}

export function parseTokenFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get('token');
  } catch {
    return null;
  }
}
