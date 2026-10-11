use std::path::PathBuf;
use std::sync::Mutex;
use rusqlite::{types::ValueRef, Connection, ToSql};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use crate::error::AppError;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecuteResult {
    pub rows_affected: usize,
    pub last_insert_id: i64,
}

pub struct DatabaseManager {
    conn: Mutex<Connection>,
}

impl DatabaseManager {
    pub fn new(db_path: PathBuf) -> Result<Self, AppError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;
        let mgr = Self {
            conn: Mutex::new(conn),
        };
        mgr.init_schema()?;
        Ok(mgr)
    }

    pub fn new_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()?;
        let mgr = Self {
            conn: Mutex::new(conn),
        };
        mgr.init_schema()?;
        Ok(mgr)
    }

    fn init_schema(&self) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Custom(e.to_string()))?;

        // 🚀 SQLite Performance Pragmas
        conn.pragma_update(None, "page_size", 4096)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "cache_size", -64000)?;
        conn.pragma_update(None, "mmap_size", 134217728)?;
        conn.pragma_update(None, "temp_store", "MEMORY")?;
        conn.pragma_update(None, "busy_timeout", 5000)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        // 1. Benchmarks Table
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS benchmarks (
                document_id INTEGER NOT NULL,
                page_number INTEGER NOT NULL,
                mode TEXT NOT NULL CHECK(mode IN ('baseline', 'improve')),
                config_hash TEXT NOT NULL,
                results TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                PRIMARY KEY (document_id, page_number, mode, config_hash),
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_benchmarks_doc_page ON benchmarks(document_id, page_number);
            CREATE INDEX IF NOT EXISTS idx_benchmarks_lookup ON benchmarks(document_id, page_number, mode, config_hash);
            "#,
        )?;

        // 2. Core Tables
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                color TEXT DEFAULT '#6366f1',
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                icon TEXT DEFAULT '📁',
                color TEXT DEFAULT '#6366f1',
                parent_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            );

            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filepath TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL,
                file_type TEXT DEFAULT 'pdf',
                file_size INTEGER DEFAULT 0,
                total_pages INTEGER DEFAULT 0,
                thumbnail_path TEXT,
                project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                is_favorite INTEGER DEFAULT 0,
                is_thumbnail_hidden INTEGER DEFAULT 0,
                rating INTEGER DEFAULT 0,
                last_page INTEGER DEFAULT 1,
                last_accessed INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            );

            CREATE TABLE IF NOT EXISTS document_tags (
                document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (document_id, tag_id)
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
                document_id UNINDEXED,
                search_text,
                tokenize='unicode61'
            );

            CREATE TABLE IF NOT EXISTS ocr_cache (
                document_id INTEGER,
                page_number INTEGER,
                ocr_data TEXT,
                updated_at INTEGER,
                PRIMARY KEY (document_id, page_number),
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS ocr_cache_engine (
                document_id INTEGER,
                page_number INTEGER,
                ocr_engine TEXT NOT NULL,
                ocr_data TEXT,
                updated_at INTEGER,
                PRIMARY KEY (document_id, page_number, ocr_engine),
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS translation_cache (
                document_id INTEGER NOT NULL,
                page_number INTEGER NOT NULL,
                cache_key TEXT NOT NULL,
                ocr_engine TEXT NOT NULL,
                ocr_language TEXT NOT NULL,
                source_language TEXT NOT NULL,
                target_language TEXT NOT NULL,
                translation_mode TEXT NOT NULL,
                translator_engine TEXT NOT NULL,
                source_fingerprint TEXT NOT NULL,
                translated_by_index TEXT NOT NULL,
                translated_text TEXT NOT NULL,
                line_count INTEGER DEFAULT 0,
                group_count INTEGER DEFAULT 0,
                width INTEGER DEFAULT 0,
                height INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (document_id, page_number, cache_key),
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sentence_translation_cache (
                source_text TEXT NOT NULL,
                source_language TEXT NOT NULL,
                target_language TEXT NOT NULL,
                translator_engine TEXT NOT NULL,
                translation_mode TEXT NOT NULL,
                translated_text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (source_text, source_language, target_language, translator_engine, translation_mode)
            );

            CREATE INDEX IF NOT EXISTS idx_documents_filepath ON documents(filepath);
            CREATE INDEX IF NOT EXISTS idx_documents_last_accessed ON documents(last_accessed DESC);
            CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
            CREATE INDEX IF NOT EXISTS idx_documents_favorite ON documents(is_favorite);
            CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);
            CREATE INDEX IF NOT EXISTS idx_sentence_translation_lookup ON sentence_translation_cache(source_text, source_language, target_language, translator_engine);
            CREATE INDEX IF NOT EXISTS idx_ocr_cache_lookup ON ocr_cache(document_id, page_number);
            CREATE INDEX IF NOT EXISTS idx_ocr_cache_engine_lookup ON ocr_cache_engine(document_id, page_number, ocr_engine);
            CREATE INDEX IF NOT EXISTS idx_ocr_cache_engine_latest ON ocr_cache_engine(document_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_translation_cache_lookup ON translation_cache(document_id, page_number, ocr_engine, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
            CREATE INDEX IF NOT EXISTS idx_document_tags_tag_id ON document_tags(tag_id);

            CREATE TRIGGER IF NOT EXISTS trg_documents_insert AFTER INSERT ON documents
            BEGIN
                INSERT INTO document_search(document_id, search_text) 
                VALUES (new.id, new.filename);
            END;

            CREATE TRIGGER IF NOT EXISTS trg_documents_update AFTER UPDATE ON documents
            BEGIN
                UPDATE document_search SET search_text = new.filename WHERE document_id = old.id;
            END;

            CREATE TRIGGER IF NOT EXISTS trg_documents_delete AFTER DELETE ON documents
            BEGIN
                DELETE FROM document_search WHERE document_id = old.id;
            END;

            CREATE TABLE IF NOT EXISTS translation_glossary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_text TEXT NOT NULL,
                target_text TEXT NOT NULL,
                source_lang TEXT DEFAULT 'all',
                target_lang TEXT DEFAULT 'th',
                type TEXT CHECK(type IN ('TERM', 'SFX')) DEFAULT 'TERM',
                is_active INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                UNIQUE(source_text, source_lang, target_lang, type)
            );

            CREATE INDEX IF NOT EXISTS idx_glossary_lookup ON translation_glossary(source_text, source_lang, target_lang);
            CREATE INDEX IF NOT EXISTS idx_glossary_active ON translation_glossary(is_active);
            "#,
        )?;

        // Auto-migrations for backwards compatibility
        let _ = conn.execute("ALTER TABLE documents ADD COLUMN rating INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE documents ADD COLUMN is_thumbnail_hidden INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE translation_cache ADD COLUMN width INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE translation_cache ADD COLUMN height INTEGER DEFAULT 0", []);

        Ok(())
    }

    pub fn query(&self, sql: &str, params: Vec<Value>) -> Result<Vec<Value>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Custom(e.to_string()))?;
        let mut stmt = conn.prepare(sql)?;
        let col_names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();

        let boxed_params: Vec<Box<dyn ToSql>> = params.into_iter().map(value_to_sql).collect();
        let slice_params: Vec<&dyn ToSql> = boxed_params.iter().map(|b| b.as_ref()).collect();

        let mut rows = stmt.query(slice_params.as_slice())?;
        let mut results = Vec::new();

        while let Some(row) = rows.next()? {
            let mut map = Map::new();
            for (idx, col) in col_names.iter().enumerate() {
                let val_ref = row.get_ref(idx)?;
                let json_val = sql_val_to_json(val_ref);
                map.insert(col.clone(), json_val);
            }
            results.push(Value::Object(map));
        }

        Ok(results)
    }

    pub fn execute(&self, sql: &str, params: Vec<Value>) -> Result<ExecuteResult, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Custom(e.to_string()))?;
        let boxed_params: Vec<Box<dyn ToSql>> = params.into_iter().map(value_to_sql).collect();
        let slice_params: Vec<&dyn ToSql> = boxed_params.iter().map(|b| b.as_ref()).collect();

        let rows_affected = conn.execute(sql, slice_params.as_slice())?;
        let last_insert_id = conn.last_insert_rowid();

        Ok(ExecuteResult {
            rows_affected,
            last_insert_id,
        })
    }
}

fn value_to_sql(val: Value) -> Box<dyn ToSql> {
    match val {
        Value::Null => Box::new(rusqlite::types::Null),
        Value::Bool(b) => Box::new(b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        Value::String(s) => Box::new(s),
        Value::Array(_) | Value::Object(_) => Box::new(val.to_string()),
    }
}

fn sql_val_to_json(val_ref: ValueRef) -> Value {
    match val_ref {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(b) => Value::String(format!("[Blob: {} bytes]", b.len())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_init_and_crud() {
        let db = DatabaseManager::new_in_memory().expect("Should initialize in-memory DB");

        // Insert document
        let exec_res = db.execute(
            "INSERT INTO documents (filepath, filename, total_pages) VALUES (?, ?, ?)",
            vec![json!("test.pdf"), json!("test.pdf"), json!(10)],
        ).expect("Execute insert should succeed");

        assert_eq!(exec_res.rows_affected, 1);
        let doc_id = exec_res.last_insert_id;

        // Query document
        let rows = db.query(
            "SELECT id, filepath, filename, total_pages, rating FROM documents WHERE id = ?",
            vec![json!(doc_id)],
        ).expect("Query should succeed");

        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row["id"], json!(doc_id));
        assert_eq!(row["filename"], json!("test.pdf"));
        assert_eq!(row["rating"], json!(0)); // verifying auto-migration column

        // BenchmarkDAO operations
        let bm_insert = db.execute(
            r#"
            INSERT INTO benchmarks (document_id, page_number, mode, config_hash, results)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(document_id, page_number, mode, config_hash)
            DO UPDATE SET results = excluded.results
            "#,
            vec![
                json!(doc_id),
                json!(1),
                json!("baseline"),
                json!("hash123"),
                json!(r#"{"score": 95}"#),
            ],
        ).expect("Benchmark insert should succeed");
        assert_eq!(bm_insert.rows_affected, 1);

        let bm_rows = db.query(
            "SELECT results FROM benchmarks WHERE document_id = ? AND page_number = ? AND mode = ? AND config_hash = ?",
            vec![json!(doc_id), json!(1), json!("baseline"), json!("hash123")],
        ).expect("Benchmark query should succeed");

        assert_eq!(bm_rows.len(), 1);
        assert_eq!(bm_rows[0]["results"], json!(r#"{"score": 95}"#));
    }
}

