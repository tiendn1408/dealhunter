package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/pkg/config"
	// other imports will be needed but omitted for skeleton
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Load config failed: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	logger.Info("Starting worker", "concurrency", cfg.WorkerConcurrency)

	// wire dependencies:
	// db, redis
	// repos
	// registry
	// queue

	worker := jobs.NewWorker(
		cfg.WorkerConcurrency,
		nil, // queue
		nil, // jobRepo
		nil, // productRepo
		nil, // pricingRepo
		nil, // registry
		logger,
	)

	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		logger.Info("Shutting down worker...")
		cancel()
	}()

	if err := worker.Run(ctx); err != nil {
		logger.Error("Worker exit with error", "err", err)
	}
}
