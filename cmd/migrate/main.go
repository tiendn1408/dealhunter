package main

import (
	"flag"
	"fmt"
	"log"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/tiendang/deal-hunter/pkg/config"
)

func main() {
	direction := flag.String("dir", "up", "Migration direction: up, down (one step) or down-all")
	steps := flag.Int("steps", 1, "Number of migrations to roll back with down")
	force := flag.Bool("force", false, "Required for down-all, which drops every table")
	flag.Parse()

	// Positional form: migrate up | migrate down [-steps N] | migrate down-all -force
	if args := flag.Args(); len(args) > 0 {
		*direction = args[0]
		if err := flag.CommandLine.Parse(args[1:]); err != nil {
			log.Fatalf("Invalid flags: %v", err)
		}
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Wait for DB to be ready in docker-compose if needed
	// using direct URL for migrate

	m, err := migrate.New(
		"file://migrations",
		cfg.DatabaseURL, // Need to make sure URL uses pgx driver e.g. "pgx://..." or just "postgres://..."
	)
	if err != nil {
		log.Fatalf("Failed to initialize migrate: %v", err)
	}

	if *direction == "up" {
		if err := m.Up(); err != nil && err != migrate.ErrNoChange {
			log.Fatalf("Failed to migrate up: %v", err)
		}
		fmt.Println("Migrated UP successfully.")
	} else if *direction == "down" {
		if *steps < 1 {
			log.Fatalf("-steps must be >= 1")
		}
		if err := m.Steps(-*steps); err != nil && err != migrate.ErrNoChange {
			log.Fatalf("Failed to migrate down: %v", err)
		}
		fmt.Printf("Rolled back %d migration(s) successfully.\n", *steps)
	} else if *direction == "down-all" {
		if !*force {
			log.Fatalf("down-all drops ALL tables and data; re-run with -force to confirm")
		}
		if err := m.Down(); err != nil && err != migrate.ErrNoChange {
			log.Fatalf("Failed to migrate down-all: %v", err)
		}
		fmt.Println("Rolled back ALL migrations.")
	} else {
		log.Fatalf("Unknown direction: %s", *direction)
	}
}
