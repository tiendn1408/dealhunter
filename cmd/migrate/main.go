package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/tiendang/deal-hunter/pkg/config"
)

func main() {
	direction := flag.String("dir", "up", "Migration direction: up or down")
	flag.Parse()

	if len(os.Args) > 1 && (os.Args[1] == "up" || os.Args[1] == "down") {
		*direction = os.Args[1]
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
		if err := m.Down(); err != nil && err != migrate.ErrNoChange {
			log.Fatalf("Failed to migrate down: %v", err)
		}
		fmt.Println("Migrated DOWN successfully.")
	} else {
		log.Fatalf("Unknown direction: %s", *direction)
	}
}
