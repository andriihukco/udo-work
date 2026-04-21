/**
 * ProjectService — manages project records in the `projects` table.
 *
 * Responsibilities:
 *  - getActiveProjects: return all projects where is_active = true
 *  - getAllProjects: return all projects regardless of active status
 *  - createProject: insert a new project with is_active = true; throws DuplicateProjectError on name collision
 *  - deactivateProject: set is_active = false for a given project
 *  - findById: return a project by its UUID or null if not found
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { DatabaseError, DuplicateProjectError, Project } from '@/types/index';
import type { ProjectRow } from '@/lib/db/types';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ProjectService {
  /** Return all projects with is_active = true. */
  getActiveProjects(): Promise<Project[]>;

  /** Return all projects (active and inactive). */
  getAllProjects(): Promise<Project[]>;

  /**
   * Create a new project with is_active = true.
   * Throws `DuplicateProjectError` if a project with the same name already exists.
   */
  createProject(name: string): Promise<Project>;

  /** Set is_active = false for the given project. */
  deactivateProject(projectId: string): Promise<void>;

  /** Return the project with the given ID, or null if not found. */
  findById(projectId: string): Promise<Project | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a raw `ProjectRow` to the domain `Project` type. */
function mapRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

/**
 * Returns true when the Supabase error code indicates a unique constraint
 * violation (PostgreSQL error code 23505).
 */
function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505';
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const projectService: ProjectService = {
  /**
   * Queries the `projects` table for rows where `is_active = true`,
   * ordered by name for consistent display.
   */
  async getActiveProjects(): Promise<Project[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, is_active, created_at')
      .eq('is_active', true)
      .order('name');

    if (error) {
      logger.error('ProjectService.getActiveProjects failed', error);
      throw new DatabaseError('Failed to fetch active projects');
    }

    return (data ?? []).map((row) => mapRow(row as ProjectRow));
  },

  /**
   * Queries all rows in the `projects` table, ordered by name.
   */
  async getAllProjects(): Promise<Project[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, is_active, created_at')
      .order('name');

    if (error) {
      logger.error('ProjectService.getAllProjects failed', error);
      throw new DatabaseError('Failed to fetch projects');
    }

    return (data ?? []).map((row) => mapRow(row as ProjectRow));
  },

  /**
   * Inserts a new project row with `is_active = true`.
   * Throws `DuplicateProjectError` when the `name` unique constraint is violated.
   */
  async createProject(name: string): Promise<Project> {
    const { data, error } = await supabase
      .from('projects')
      .insert({ name, is_active: true })
      .select('id, name, is_active, created_at')
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateProjectError(
          `A project named "${name}" already exists`
        );
      }
      logger.error('ProjectService.createProject failed', error);
      throw new DatabaseError('Failed to create project');
    }

    if (!data) {
      throw new DatabaseError('Failed to create project: no data returned');
    }

    return mapRow(data as ProjectRow);
  },

  /**
   * Sets `is_active = false` for the project identified by `projectId`.
   */
  async deactivateProject(projectId: string): Promise<void> {
    const { error } = await supabase
      .from('projects')
      .update({ is_active: false })
      .eq('id', projectId);

    if (error) {
      logger.error('ProjectService.deactivateProject failed', error);
      throw new DatabaseError('Failed to deactivate project');
    }
  },

  /**
   * Returns the project with the given `projectId`, or `null` if no row is found.
   * Uses `maybeSingle()` so a missing row is not treated as an error.
   */
  async findById(projectId: string): Promise<Project | null> {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, is_active, created_at')
      .eq('id', projectId)
      .maybeSingle();

    if (error) {
      logger.error('ProjectService.findById failed', error);
      throw new DatabaseError('Failed to find project by ID');
    }

    return data ? mapRow(data as ProjectRow) : null;
  },
};
