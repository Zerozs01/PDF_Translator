import type Database from 'better-sqlite3-multiple-ciphers';

export interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
}

export class ProjectDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('ProjectDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static getAllProjects(): ProjectRow[] {
    const stmt = this.getStmt('SELECT * FROM projects ORDER BY name ASC');
    return stmt.all() as ProjectRow[];
  }

  static getProjectById(id: number): ProjectRow | undefined {
    const stmt = this.getStmt('SELECT * FROM projects WHERE id = ?');
    return stmt.get(id) as ProjectRow | undefined;
  }

  static getSubprojects(parentId: number | null): ProjectRow[] {
    if (parentId === null) {
      const stmt = this.getStmt('SELECT * FROM projects WHERE parent_id IS NULL ORDER BY name ASC');
      return stmt.all() as ProjectRow[];
    }
    const stmt = this.getStmt('SELECT * FROM projects WHERE parent_id = ? ORDER BY name ASC');
    return stmt.all(parentId) as ProjectRow[];
  }

  static insertProject(project: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    parent_id?: number | null;
  }): ProjectRow {
    const now = Date.now();
    const stmt = this.getStmt(`
      INSERT INTO projects (name, description, icon, color, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      project.name,
      project.description || null,
      project.icon || '📁',
      project.color || '#6366f1',
      project.parent_id || null,
      now,
      now
    );

    return this.getProjectById(Number(info.lastInsertRowid))!;
  }

  static updateProject(
    id: number,
    updates: {
      name?: string;
      description?: string;
      icon?: string;
      color?: string;
      parent_id?: number | null;
    }
  ): ProjectRow | undefined {
    const existing = this.getProjectById(id);
    if (!existing) return undefined;

    const now = Date.now();
    const name = updates.name !== undefined ? updates.name : existing.name;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const icon = updates.icon !== undefined ? updates.icon : existing.icon;
    const color = updates.color !== undefined ? updates.color : existing.color;
    const parent_id = updates.parent_id !== undefined ? updates.parent_id : existing.parent_id;

    const stmt = this.getStmt(`
      UPDATE projects 
      SET name = ?, description = ?, icon = ?, color = ?, parent_id = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(name, description, icon, color, parent_id, now, id);
    return this.getProjectById(id);
  }

  static deleteProject(id: number): void {
    const stmt = this.getStmt('DELETE FROM projects WHERE id = ?');
    stmt.run(id);
  }
}
