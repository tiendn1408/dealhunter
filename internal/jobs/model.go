package jobs

import "github.com/tiendang/deal-hunter/internal/domain"

// Type aliases re-exported from domain for backward compatibility.
// Code within this package MUST use domain.* directly to avoid cycles.

type JobStatus = domain.JobStatus
type FetchJob = domain.FetchJob

const (
	JobStatusQueued    = domain.JobStatusQueued
	JobStatusRunning   = domain.JobStatusRunning
	JobStatusSucceeded = domain.JobStatusSucceeded
	JobStatusFailed    = domain.JobStatusFailed
	JobStatusDead      = domain.JobStatusDead
)
