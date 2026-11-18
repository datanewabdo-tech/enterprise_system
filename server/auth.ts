

import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { Role } from '@prisma/client';

import jwt, { Secret } from 'jsonwebtoken';

const JWT_SECRET: Secret = (() => {
  const secret = process.env.JWT_SECRET;

  if (!secret || !secret.trim()) {
    throw new Error(
      'JWT_SECRET is not configured. Set JWT_SECRET in your environment.',
    );
  }

  return secret;
})();

export type UserRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'DATA_MANAGER'
  | 'DATA_ANALYST'
  | 'VIEWER';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: string;
}

const VALID_ROLES = Object.values(Role);

function isUserRole(role: unknown): role is UserRole {
  return typeof role === 'string' &&
    VALID_ROLES.includes(role as Role);
}

// Generate JWT
export function generateToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

// Verify JWT
export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (
      typeof decoded === 'string' ||
      typeof decoded.id !== 'number' ||
      typeof decoded.username !== 'string' ||
      typeof decoded.email !== 'string' ||
      typeof decoded.fullName !== 'string' ||
      !isUserRole(decoded.role)
    ) {
      return null;
    }

    return {
      id: decoded.id,
      username: decoded.username,
      email: decoded.email,
      fullName: decoded.fullName,
      role: decoded.role,
      status: 'ACTIVE',
    };
  } catch {
    return null;
  }
}

// Authenticate user using PostgreSQL + Prisma
export async function authenticateUser(
  usernameOrEmail: string,
  passwordPlain: string
): Promise<{ user: AuthUser; token: string } | null> {
  const identifier = usernameOrEmail.trim();

  if (!identifier || !passwordPlain) {
    return null;
  }

  try {
    const row = await db.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: identifier },
        ],
        status: 'ACTIVE',
      },
    });

    if (!row) {
      return null;
    }

    const isMatch = await bcrypt.compare(
      passwordPlain,
      row.passwordHash
    );

    if (!isMatch) {
      return null;
    }

    const updatedUser = await db.user.update({
      where: { id: row.id },
      data: {
        lastLogin: new Date(),
      },
    });

    const authUser: AuthUser = {
      id: updatedUser.id,
      username: updatedUser.username,
      email: updatedUser.email,
      fullName: updatedUser.fullName,
      role: updatedUser.role as UserRole,
      status: updatedUser.status,
    };

    return {
      user: authUser,
      token: generateToken(authUser),
    };
  } catch (error) {
    console.error('Authentication error:', error);
    throw new Error('Authentication service unavailable');
  }
}

// Role permissions
export const ROLE_PERMISSIONS: Record<UserRole, {
  canViewTables: boolean;
  canEditRecords: boolean;
  canDeleteRecords: boolean;
  canImport: boolean;
  canExport: boolean;
  canManageUsers: boolean;
  canViewUnmaskedData: boolean;
  canManageSettings: boolean;
}> = {
  SUPER_ADMIN: {
    canViewTables: true,
    canEditRecords: true,
    canDeleteRecords: true,
    canImport: true,
    canExport: true,
    canManageUsers: true,
    canViewUnmaskedData: true,
    canManageSettings: true,
  },
  ADMIN: {
    canViewTables: true,
    canEditRecords: true,
    canDeleteRecords: true,
    canImport: true,
    canExport: true,
    canManageUsers: true,
    canViewUnmaskedData: true,
    canManageSettings: false,
  },
  DATA_MANAGER: {
    canViewTables: true,
    canEditRecords: true,
    canDeleteRecords: false,
    canImport: true,
    canExport: true,
    canManageUsers: false,
    canViewUnmaskedData: true,
    canManageSettings: false,
  },
  DATA_ANALYST: {
    canViewTables: true,
    canEditRecords: false,
    canDeleteRecords: false,
    canImport: false,
    canExport: true,
    canManageUsers: false,
    canViewUnmaskedData: false,
    canManageSettings: false,
  },
  VIEWER: {
    canViewTables: true,
    canEditRecords: false,
    canDeleteRecords: false,
    canImport: false,
    canExport: false,
    canManageUsers: false,
    canViewUnmaskedData: false,
    canManageSettings: false,
  },
};

// Data masking intentionally disabled for this workspace.
export function maskSensitiveRecord(
  record: Record<string, any>,
  unmask: boolean
): Record<string, any> {
  return record;
}
