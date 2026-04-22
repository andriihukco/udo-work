/**
 * MembershipService — manages project_members and invite_tokens tables.
 *
 * - Assign/remove employees from projects
 * - Generate invite links (deep links via bot username)
 * - Redeem invite tokens
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { DatabaseError, Project, User } from '@/types/index';
import type { ProjectMemberRow, InviteTokenRow } from '@/lib/db/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
  // 24-char URL-safe random token
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 24; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface MembershipService {
  /** Get all projects an employee is a member of (active only). */
  getProjectsForUser(userId: string): Promise<Project[]>;

  /** Get all members of a project. */
  getMembersOfProject(projectId: string): Promise<User[]>;

  /** Add an employee to a project. No-op if already a member. */
  addMember(projectId: string, userId: string): Promise<void>;

  /** Remove an employee from a project. */
  removeMember(projectId: string, userId: string): Promise<void>;

  /** Check if a user is a member of a project. */
  isMember(projectId: string, userId: string): Promise<boolean>;

  /**
   * Generate an invite token for a project.
   * Returns the full bot deep-link URL.
   * Token expires in 7 days.
   */
  createInviteLink(projectId: string, role: 'admin' | 'employee', createdBy: string): Promise<string>;

  /** Redeem an invite token. Returns the project and role, or null if invalid/expired. */
  redeemToken(token: string, userId: string): Promise<{ project: Project; role: 'admin' | 'employee' } | null>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const membershipService: MembershipService = {
  async getProjectsForUser(userId: string): Promise<Project[]> {
    // Get project IDs for this user first, then fetch the projects
    const { data: memberRows, error: memberError } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', userId);

    if (memberError) {
      logger.error('MembershipService.getProjectsForUser: members query failed', memberError);
      throw new DatabaseError('Failed to fetch projects for user');
    }

    if (!memberRows || memberRows.length === 0) return [];

    const projectIds = memberRows.map((r: any) => r.project_id);

    const { data, error } = await supabase
      .from('projects')
      .select('id, name, is_active, created_at')
      .in('id', projectIds)
      .eq('is_active', true)
      .order('name');

    if (error) {
      logger.error('MembershipService.getProjectsForUser: projects query failed', error);
      throw new DatabaseError('Failed to fetch projects for user');
    }

    return (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      is_active: row.is_active,
      created_at: row.created_at,
    }));
  },

  async getMembersOfProject(projectId: string): Promise<User[]> {
    const { data: memberRows, error: memberError } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId);

    if (memberError) {
      logger.error('MembershipService.getMembersOfProject: members query failed', memberError);
      throw new DatabaseError('Failed to fetch members of project');
    }

    if (!memberRows || memberRows.length === 0) return [];

    const userIds = memberRows.map((r: any) => r.user_id);

    const { data, error } = await supabase
      .from('users')
      .select('id, telegram_id, role, first_name, username, created_at')
      .in('id', userIds);

    if (error) {
      logger.error('MembershipService.getMembersOfProject: users query failed', error);
      throw new DatabaseError('Failed to fetch members of project');
    }

    return (data ?? []).map((row: any) => ({
      id: row.id,
      telegram_id: row.telegram_id,
      role: row.role,
      first_name: row.first_name,
      username: row.username,
      hourly_rate: row.hourly_rate ?? null,
      created_at: row.created_at,
    }));
  },

  async addMember(projectId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('project_members')
      .upsert({ project_id: projectId, user_id: userId }, { onConflict: 'project_id,user_id' });

    if (error) {
      logger.error('MembershipService.addMember failed', error);
      throw new DatabaseError('Failed to add member to project');
    }
  },

  async removeMember(projectId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);

    if (error) {
      logger.error('MembershipService.removeMember failed', error);
      throw new DatabaseError('Failed to remove member from project');
    }
  },

  async isMember(projectId: string, userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error('MembershipService.isMember failed', error);
      return false;
    }
    return data !== null;
  },

  async createInviteLink(projectId: string, role: 'admin' | 'employee', createdBy: string): Promise<string> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('invite_tokens')
      .insert({ token, project_id: projectId, role, created_by: createdBy, expires_at: expiresAt });

    if (error) {
      logger.error('MembershipService.createInviteLink failed', error);
      throw new DatabaseError('Failed to create invite token');
    }

    const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? 'udoworkbot';
    return `https://t.me/${botUsername}?start=invite_${token}`;
  },

  async redeemToken(token: string, userId: string): Promise<{ project: Project; role: 'admin' | 'employee' } | null> {
    const { data, error } = await supabase
      .from('invite_tokens')
      .select('token, project_id, role, used_by, expires_at, used_at')
      .eq('token', token)
      .maybeSingle();

    if (error || !data) {
      logger.error('MembershipService.redeemToken: token not found', error);
      return null;
    }

    const row = data as any;

    // Already used
    if (row.used_by !== null) return null;

    // Expired
    if (new Date(row.expires_at) < new Date()) return null;

    // Fetch the project separately
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('id, name, is_active, created_at')
      .eq('id', row.project_id)
      .maybeSingle();

    if (projectError || !projectData) {
      logger.error('MembershipService.redeemToken: project not found', projectError);
      return null;
    }

    // Mark as used
    await supabase
      .from('invite_tokens')
      .update({ used_by: userId, used_at: new Date().toISOString() })
      .eq('token', token);

    const project: Project = {
      id: projectData.id,
      name: projectData.name,
      is_active: projectData.is_active,
      created_at: projectData.created_at,
    };

    return { project, role: row.role as 'admin' | 'employee' };
  },
};
