package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	PriceFetchTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "dealhunter",
			Subsystem: "fetch",
			Name:      "price_fetch_total",
			Help:      "Total number of price fetch attempts",
		},
		[]string{"platform", "status"},
	)

	PriceFetchDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "dealhunter",
			Subsystem: "fetch",
			Name:      "price_fetch_duration_seconds",
			Help:      "Duration of price fetch operations",
			Buckets:   []float64{0.1, 0.25, 0.5, 1, 2.5, 5, 10},
		},
		[]string{"platform"},
	)

	PriceSnapshotsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: "dealhunter",
			Subsystem: "pricing",
			Name:      "price_snapshots_total",
			Help:      "Total number of price snapshots successfully saved",
		},
	)

	ActiveTrackedProducts = promauto.NewGauge(
		prometheus.GaugeOpts{
			Namespace: "dealhunter",
			Subsystem: "tracking",
			Name:      "active_tracked_products",
			Help:      "Current number of active tracked products",
		},
	)

	JobRetryTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: "dealhunter",
			Subsystem: "jobs",
			Name:      "job_retry_total",
			Help:      "Total number of job retries",
		},
	)

	QueueDepth = promauto.NewGauge(
		prometheus.GaugeOpts{
			Namespace: "dealhunter",
			Subsystem: "queue",
			Name:      "queue_depth",
			Help:      "Current length of the fetch job stream",
		},
	)

	NotifierSentTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: "dealhunter",
			Subsystem: "notifier",
			Name:      "notifier_sent_total",
			Help:      "Total number of successfully sent notifications",
		},
	)

	NotifierFailedTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: "dealhunter",
			Subsystem: "notifier",
			Name:      "notifier_failed_total",
			Help:      "Total number of failed notification attempts",
		},
	)
)
