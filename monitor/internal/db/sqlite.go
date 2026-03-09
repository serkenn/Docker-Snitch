package db

import (
	"database/sql"
	"log"

	_ "modernc.org/sqlite"
)

// Open opens or creates the SQLite database
func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}

	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}

	log.Printf("database: opened %s", path)
	return db, nil
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS rules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			container_name TEXT NOT NULL DEFAULT '*',
			direction TEXT NOT NULL DEFAULT 'both',
			remote_host TEXT NOT NULL DEFAULT '*',
			remote_port INTEGER NOT NULL DEFAULT 0,
			protocol TEXT NOT NULL DEFAULT '*',
			action TEXT NOT NULL DEFAULT 'allow',
			priority INTEGER NOT NULL DEFAULT 100,
			enabled BOOLEAN NOT NULL DEFAULT 1,
			note TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS connection_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			container_name TEXT NOT NULL,
			container_ip TEXT NOT NULL,
			remote_ip TEXT NOT NULL,
			remote_domain TEXT NOT NULL DEFAULT '',
			remote_port INTEGER NOT NULL,
			local_port INTEGER NOT NULL,
			protocol TEXT NOT NULL,
			direction TEXT NOT NULL,
			action TEXT NOT NULL,
			bytes_sent INTEGER NOT NULL DEFAULT 0,
			bytes_recv INTEGER NOT NULL DEFAULT 0,
			start_time DATETIME NOT NULL,
			end_time DATETIME NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_conn_log_container ON connection_log(container_name);
		CREATE INDEX IF NOT EXISTS idx_conn_log_time ON connection_log(start_time);
	`)
	return err
}
