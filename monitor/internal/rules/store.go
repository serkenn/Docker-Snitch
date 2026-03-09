package rules

import (
	"database/sql"
	"time"
)

// Store provides database operations for rules
type Store struct {
	db *sql.DB
}

// NewStore creates a new rule store
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// List returns all rules
func (s *Store) List() ([]Rule, error) {
	rows, err := s.db.Query(`SELECT id, container_name, direction, remote_host, remote_port, protocol, action, priority, enabled, note, created_at, updated_at FROM rules ORDER BY priority`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []Rule
	for rows.Next() {
		var r Rule
		if err := rows.Scan(&r.ID, &r.ContainerName, &r.Direction, &r.RemoteHost, &r.RemotePort, &r.Protocol, &r.Action, &r.Priority, &r.Enabled, &r.Note, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		rules = append(rules, r)
	}
	return rules, rows.Err()
}

// Create inserts a new rule
func (s *Store) Create(r *Rule) error {
	now := time.Now()
	r.CreatedAt = now
	r.UpdatedAt = now
	result, err := s.db.Exec(
		`INSERT INTO rules (container_name, direction, remote_host, remote_port, protocol, action, priority, enabled, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ContainerName, r.Direction, r.RemoteHost, r.RemotePort, r.Protocol, r.Action, r.Priority, r.Enabled, r.Note, r.CreatedAt, r.UpdatedAt,
	)
	if err != nil {
		return err
	}
	r.ID, _ = result.LastInsertId()
	return nil
}

// Update modifies an existing rule
func (s *Store) Update(r *Rule) error {
	r.UpdatedAt = time.Now()
	_, err := s.db.Exec(
		`UPDATE rules SET container_name=?, direction=?, remote_host=?, remote_port=?, protocol=?, action=?, priority=?, enabled=?, note=?, updated_at=? WHERE id=?`,
		r.ContainerName, r.Direction, r.RemoteHost, r.RemotePort, r.Protocol, r.Action, r.Priority, r.Enabled, r.Note, r.UpdatedAt, r.ID,
	)
	return err
}

// Delete removes a rule
func (s *Store) Delete(id int64) error {
	_, err := s.db.Exec(`DELETE FROM rules WHERE id=?`, id)
	return err
}

// Get returns a single rule by ID
func (s *Store) Get(id int64) (*Rule, error) {
	var r Rule
	err := s.db.QueryRow(
		`SELECT id, container_name, direction, remote_host, remote_port, protocol, action, priority, enabled, note, created_at, updated_at FROM rules WHERE id=?`, id,
	).Scan(&r.ID, &r.ContainerName, &r.Direction, &r.RemoteHost, &r.RemotePort, &r.Protocol, &r.Action, &r.Priority, &r.Enabled, &r.Note, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}
