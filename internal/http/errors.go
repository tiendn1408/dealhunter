package router

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tiendang/deal-hunter/internal/tracking"
)

// msgGroupShared answers a user change to a comparison group someone else also tracks (SEC-07).
const msgGroupShared = "Nhóm so sánh này có người khác cùng theo dõi nên không thể thay đổi thủ công; hệ thống sẽ tự ghép các nguồn khớp."

func (h *Handler) log() *slog.Logger {
	if h.logger != nil {
		return h.logger
	}
	return slog.Default()
}

// serverError logs the internal error and returns a generic 500, so database or upstream details
// never reach the client (SEC-12).
func (h *Handler) serverError(w http.ResponseWriter, r *http.Request, err error) {
	// A guest token used while (or after) its guest was merged into a member account: the session is over
	if isMigratedUserWrite(err) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	h.log().Error("request failed",
		"method", r.Method,
		"path", r.URL.Path,
		"request_id", middleware.GetReqID(r.Context()),
		"err", err,
	)
	http.Error(w, "internal server error", http.StatusInternalServerError)
}

// accessError answers a failed product/source access check. Resources the caller may not access are
// reported as not found so their existence is not revealed.
func (h *Handler) accessError(w http.ResponseWriter, r *http.Request, err error, notFoundMsg string) {
	if errors.Is(err, tracking.ErrProductNotFound) {
		http.Error(w, notFoundMsg, http.StatusNotFound)
		return
	}
	h.serverError(w, r, err)
}

// isBadProductURL reports errors caused by a URL that is not a supported marketplace product link.
func isBadProductURL(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "unsupported or unregistered platform") ||
		strings.Contains(msg, "invalid url") ||
		strings.Contains(msg, "invalid host") ||
		strings.Contains(msg, "detect platform") ||
		strings.Contains(msg, "cannot parse")
}

// isMigratedUserWrite reports a write rejected because the user was merged into another account
// (SQLSTATE DH001, raised by the trigger of migration 000013).
func isMigratedUserWrite(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "DH001"
}
