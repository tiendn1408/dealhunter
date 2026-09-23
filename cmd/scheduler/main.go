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
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Load config failed: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	logger.Info("Starting scheduler", "poll_interval", cfg.DefaultPollInterval)

	// TODO: wire trackingRepo, jobRepo, queue from real DB/Redis connections.
	scheduler := jobs.NewScheduler(
		nil, // trackingRepo — wire real implementation before running
		nil, // jobRepo     — wire real implementation before running
		nil, // queue       — wire real implementation before running
		cfg.DefaultPollInterval,
		logger,
	)

	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		logger.Info("Shutting down scheduler...")
		cancel()
	}()

	if err := scheduler.Run(ctx); err != nil {
		logger.Error("Scheduler exit with error", "err", err)
	}
}
