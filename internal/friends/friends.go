// ==========================================
// ALFYCHAT - ROUTES AMIS
// ==========================================

package friends

import (
	"context"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/alfychat/friends/internal/platform"
	"github.com/google/uuid"
)

var uuidRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type handlers struct {
	db *platform.DB
}

// Migrate crée la table friends si elle n'existe pas.
func Migrate(ctx context.Context, db *platform.DB) error {
	_, err := db.Exec(ctx, `
      CREATE TABLE IF NOT EXISTS friends (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        friend_id VARCHAR(36) NOT NULL,
        status ENUM('pending', 'accepted', 'blocked') DEFAULT 'pending',
        nickname VARCHAR(64),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_friendship (user_id, friend_id),
        INDEX idx_user_friends (user_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
	return err
}

// Register déclare toutes les routes du service.
func Register(srv *platform.Server, db *platform.DB, auth *platform.Auth) {
	h := &handlers{db: db}
	a := auth.Require
	srv.Mount("/friends")

	srv.Handle("GET /friends", a(h.list))
	srv.Handle("POST /friends/request", a(h.sendRequest))
	srv.Handle("GET /friends/requests", a(h.pendingRequests))
	srv.Handle("POST /friends/request/{requestId}/accept", a(h.acceptLegacy))
	srv.Handle("POST /friends/request/{requestId}/decline", a(h.declineLegacy))
	srv.Handle("POST /friends/requests", a(h.sendRequestWS))
	srv.Handle("POST /friends/requests/{requestId}/accept", a(h.accept))
	srv.Handle("POST /friends/requests/{requestId}/decline", a(h.decline))
	srv.Handle("DELETE /friends/{friendId}", a(h.remove))
	srv.Handle("POST /friends/{userId}/block", a(h.block))
	srv.Handle("POST /friends/{userId}/unblock", a(h.unblock))
	srv.Handle("GET /friends/blocked", a(h.blocked))
	srv.Handle("GET /friends/block-status/{otherId}", a(h.blockStatus))
	srv.Handle("GET /friends/mutual/{otherId}", a(h.mutual))

	srv.Handle("GET /health", func(w http.ResponseWriter, r *http.Request) {
		platform.JSON(w, 200, platform.O("status", "ok", "service", "friends"))
	})
	srv.Handle("GET /metrics", func(w http.ResponseWriter, r *http.Request) {
		body := platform.O(
			"service", "friends",
			"serviceId", platform.Env("SERVICE_ID", "friends-default"),
			"location", strings.ToUpper(platform.Env("SERVICE_LOCATION", "EU")),
		)
		m := platform.CollectServiceMetrics()
		for _, k := range m.Keys() {
			body.Set(k, m.Get(k))
		}
		body.Set("uptime", platform.Uptime())
		platform.JSON(w, 200, body)
	})
}

func serverError(w http.ResponseWriter, msg string, err error) {
	slog.Error(msg, "err", err)
	platform.Error(w, http.StatusInternalServerError, "Erreur serveur")
}

// fetchUsersByIds lit directement la table `users` commune — pas de
// round-trip HTTP, donc pas de fallback "Unknown" si le service users tombe.
func (h *handlers) fetchUsersByIds(ctx context.Context, ids []string) (map[string]*platform.Object, error) {
	out := map[string]*platform.Object{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := h.db.Rows(ctx,
		`SELECT id, username, display_name, avatar_url, status, is_online
     FROM users WHERE id IN (`+platform.Placeholders(len(ids))+`)`,
		platform.Args(ids)...)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		status := r.Str("status")
		if status == "" {
			status = "offline"
		}
		out[r.Str("id")] = platform.O(
			"id", r.Get("id"),
			"username", r.Get("username"),
			"displayName", r.Get("display_name"),
			"avatarUrl", r.Get("avatar_url"),
			"status", status,
			"isOnline", r.Bool("is_online"),
		)
	}
	return out, nil
}

// acceptsFriendRequests : la cible accepte-t-elle les demandes d'ami ?
// Absence de ligne de préférences = réglage par défaut (accepte).
func (h *handlers) acceptsFriendRequests(ctx context.Context, targetUserID string) (bool, error) {
	row, err := h.db.First(ctx, "SELECT privacy_allow_friend_requests FROM user_preferences WHERE user_id = ?", targetUserID)
	if err != nil || row == nil {
		return true, err
	}
	v := row.Get("privacy_allow_friend_requests")
	return v == nil || row.Int("privacy_allow_friend_requests") == 1, nil
}

// createFriendRequest : logique commune d'envoi. L'expéditeur est TOUJOURS
// l'utilisateur authentifié.
func (h *handlers) createFriendRequest(ctx context.Context, fromUserID, targetUserID string) (int, *platform.Object, error) {
	if targetUserID == fromUserID {
		return 400, platform.O("error", "Vous ne pouvez pas vous envoyer une demande d'ami"), nil
	}
	users, err := h.db.Rows(ctx, "SELECT id FROM users WHERE id = ?", targetUserID)
	if err != nil {
		return 0, nil, err
	}
	if len(users) == 0 {
		return 404, platform.O("error", "Utilisateur non trouvé"), nil
	}

	existing, err := h.db.Rows(ctx,
		`SELECT id, status FROM friends
     WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
		fromUserID, targetUserID, targetUserID, fromUserID)
	if err != nil {
		return 0, nil, err
	}
	if len(existing) > 0 {
		// Même réponse qu'il y ait un blocage ou non : ne pas révéler un blocage.
		for _, r := range existing {
			if r.Str("status") == "blocked" {
				return 403, platform.O("error", "Impossible d'envoyer une demande"), nil
			}
		}
		return 409, platform.O("error", "Demande déjà envoyée ou déjà amis"), nil
	}
	ok, err := h.acceptsFriendRequests(ctx, targetUserID)
	if err != nil {
		return 0, nil, err
	}
	if !ok {
		return 403, platform.O("error", "Impossible d'envoyer une demande"), nil
	}

	requestID := uuid.NewString()
	if _, err := h.db.Exec(ctx,
		"INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)",
		requestID, fromUserID, targetUserID, "pending"); err != nil {
		return 0, nil, err
	}
	slog.Info("Demande d'ami ajoutée: " + requestID)
	return 201, platform.O(
		"success", true,
		"message", "Demande envoyée",
		"id", requestID,
		"toUserId", targetUserID,
		"fromUserId", fromUserID,
		"status", "pending",
	), nil
}

// friendIDsOf renvoie les amis acceptés d'un utilisateur.
func (h *handlers) friendIDsOf(ctx context.Context, id string) ([]string, error) {
	rows, err := h.db.Rows(ctx,
		`SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END as friendId
         FROM friends
         WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'`,
		id, id, id)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.Str("friendId")
	}
	return ids, nil
}

// pick garde les utilisateurs trouvés, dans l'ordre des IDs.
func pick(ids []string, users map[string]*platform.Object) []*platform.Object {
	out := []*platform.Object{}
	for _, id := range ids {
		if u, ok := users[id]; ok {
			out = append(out, u)
		}
	}
	return out
}

// GET /friends — amis acceptés.
func (h *handlers) list(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ids, err := h.friendIDsOf(ctx, platform.UserID(r))
	if err != nil {
		serverError(w, "Erreur récupération amis:", err)
		return
	}
	if len(ids) == 0 {
		platform.JSON(w, 200, []any{})
		return
	}
	users, err := h.fetchUsersByIds(ctx, ids)
	if err != nil {
		serverError(w, "Erreur récupération amis:", err)
		return
	}
	platform.JSON(w, 200, pick(ids, users))
}

// POST /friends/request — par ID ou par nom d'utilisateur.
func (h *handlers) sendRequest(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := platform.Body(r)
	target, ok := platform.Or(body.Get("userId"), body.Get("targetUserId")).(string)
	if !ok || target == "" || len([]rune(target)) > 64 {
		platform.Error(w, 400, "UserId ou username requis")
		return
	}

	// Si ce n'est pas un UUID, chercher par username.
	if !uuidRe.MatchString(target) {
		users, err := h.db.Rows(ctx, "SELECT id FROM users WHERE username = ?", target)
		if err != nil {
			serverError(w, "Erreur envoi demande:", err)
			return
		}
		if len(users) == 0 {
			platform.Error(w, 404, "Utilisateur non trouvé")
			return
		}
		target = users[0].Str("id")
	}

	status, res, err := h.createFriendRequest(ctx, platform.UserID(r), target)
	if err != nil {
		serverError(w, "Erreur envoi demande:", err)
		return
	}
	platform.JSON(w, status, res)
}

// GET /friends/requests — demandes reçues et envoyées en attente.
func (h *handlers) pendingRequests(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := platform.UserID(r)

	received, err := h.db.Rows(ctx,
		`SELECT f.id, f.user_id as userId
       FROM friends f
       WHERE f.friend_id = ? AND f.status = 'pending'`, userID)
	if err != nil {
		serverError(w, "Erreur récupération demandes:", err)
		return
	}
	sent, err := h.db.Rows(ctx,
		`SELECT f.id, f.friend_id as userId
       FROM friends f
       WHERE f.user_id = ? AND f.status = 'pending'`, userID)
	if err != nil {
		serverError(w, "Erreur récupération demandes:", err)
		return
	}
	if len(received) == 0 && len(sent) == 0 {
		platform.JSON(w, 200, platform.O("received", []any{}, "sent", []any{}))
		return
	}

	var all []string
	for _, row := range received {
		all = append(all, row.Str("userId"))
	}
	for _, row := range sent {
		all = append(all, row.Str("userId"))
	}
	users, err := h.fetchUsersByIds(ctx, all)
	if err != nil {
		serverError(w, "Erreur récupération demandes:", err)
		return
	}

	outReceived := []*platform.Object{}
	for _, row := range received {
		u, ok := users[row.Str("userId")]
		if !ok {
			continue
		}
		outReceived = append(outReceived, platform.O(
			"id", row.Get("id"),
			"userId", row.Get("userId"),
			"username", u.Get("username"),
			"displayName", u.Get("displayName"),
			"avatarUrl", u.Get("avatarUrl"),
			"message", "Demande d'ami",
		))
	}
	outSent := []*platform.Object{}
	for _, row := range sent {
		u, ok := users[row.Str("userId")]
		if !ok {
			continue
		}
		outSent = append(outSent, platform.O(
			"id", row.Get("id"),
			"userId", row.Get("userId"),
			"username", u.Get("username"),
			"displayName", u.Get("displayName"),
			"avatarUrl", u.Get("avatarUrl"),
		))
	}
	platform.JSON(w, 200, platform.O("received", outReceived, "sent", outSent))
}

// pendingFor renvoie la demande en attente adressée à userID.
func (h *handlers) pendingFor(ctx context.Context, requestID, userID string) (*platform.Object, error) {
	return h.db.First(ctx, "SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = ?", requestID, userID, "pending")
}

// POST /friends/request/{requestId}/accept
func (h *handlers) acceptLegacy(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	requestID := r.PathValue("requestId")
	req, err := h.pendingFor(ctx, requestID, platform.UserID(r))
	if err != nil {
		serverError(w, "Erreur acceptation demande:", err)
		return
	}
	if req == nil {
		platform.Error(w, 404, "Demande non trouvée")
		return
	}
	if _, err := h.db.Exec(ctx, "UPDATE friends SET status = ? WHERE id = ?", "accepted", requestID); err != nil {
		serverError(w, "Erreur acceptation demande:", err)
		return
	}
	slog.Info("Demande d'ami acceptée: " + requestID)
	platform.JSON(w, 200, platform.O("success", true, "message", "Demande acceptée"))
}

// POST /friends/request/{requestId}/decline
func (h *handlers) declineLegacy(w http.ResponseWriter, r *http.Request) {
	requestID := r.PathValue("requestId")
	if _, err := h.db.Exec(r.Context(),
		"DELETE FROM friends WHERE id = ? AND friend_id = ? AND status = ?",
		requestID, platform.UserID(r), "pending"); err != nil {
		serverError(w, "Erreur refus demande:", err)
		return
	}
	slog.Info("Demande d'ami refusée: " + requestID)
	platform.JSON(w, 200, platform.O("success", true, "message", "Demande refusée"))
}

// POST /friends/requests — chemin WebSocket du gateway. L'expéditeur est
// l'utilisateur authentifié, jamais un `fromUserId` du corps (amitié forcée).
func (h *handlers) sendRequestWS(w http.ResponseWriter, r *http.Request) {
	if errs := platform.Validate(r, platform.BodyField("toUserId").IsUUID()); len(errs) > 0 {
		platform.JSON(w, 400, platform.O("errors", errs))
		return
	}
	toUserID, _ := platform.Body(r).Get("toUserId").(string)
	status, res, err := h.createFriendRequest(r.Context(), platform.UserID(r), toUserID)
	if err != nil {
		serverError(w, "Erreur envoi demande:", err)
		return
	}
	platform.JSON(w, status, res)
}

// POST /friends/requests/{requestId}/accept — renvoie la ligne acceptée.
func (h *handlers) accept(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	requestID := r.PathValue("requestId")
	req, err := h.pendingFor(ctx, requestID, platform.UserID(r))
	if err != nil {
		serverError(w, "Erreur acceptation demande:", err)
		return
	}
	if req == nil {
		platform.Error(w, 404, "Demande non trouvée")
		return
	}
	if _, err := h.db.Exec(ctx, "UPDATE friends SET status = ? WHERE id = ?", "accepted", requestID); err != nil {
		serverError(w, "Erreur acceptation demande:", err)
		return
	}
	slog.Info("Demande d'ami acceptée: " + req.Str("user_id") + " <-> " + req.Str("friend_id"))
	platform.JSON(w, 200, req.Clone().Set("status", "accepted"))
}

// POST /friends/requests/{requestId}/decline
func (h *handlers) decline(w http.ResponseWriter, r *http.Request) {
	if _, err := h.db.Exec(r.Context(),
		"DELETE FROM friends WHERE id = ? AND friend_id = ? AND status = ?",
		r.PathValue("requestId"), platform.UserID(r), "pending"); err != nil {
		serverError(w, "Erreur refus demande:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

// DELETE /friends/{friendId}
func (h *handlers) remove(w http.ResponseWriter, r *http.Request) {
	userID, friendID := platform.UserID(r), r.PathValue("friendId")
	if _, err := h.db.Exec(r.Context(),
		`DELETE FROM friends
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
		userID, friendID, friendID, userID); err != nil {
		serverError(w, "Erreur suppression ami:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

// POST /friends/{userId}/block
func (h *handlers) block(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	targetID, userID := r.PathValue("userId"), platform.UserID(r)
	if targetID == "" || !uuidRe.MatchString(targetID) || targetID == userID {
		platform.Error(w, 400, "Cible de blocage invalide")
		return
	}

	// Supprimer l'amitié / la demande en cours dans les deux sens — mais JAMAIS
	// un blocage posé par la cible : bloquer puis débloquer suffisait sinon à
	// lever le blocage que l'autre avait mis sur soi.
	if _, err := h.db.Exec(ctx,
		`DELETE FROM friends
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
         AND status <> 'blocked'`,
		userID, targetID, targetID, userID); err != nil {
		serverError(w, "Erreur blocage:", err)
		return
	}
	// Créer (ou conserver) le blocage de l'appelant vers la cible.
	if _, err := h.db.Exec(ctx,
		`INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, 'blocked')
       ON DUPLICATE KEY UPDATE status = 'blocked'`,
		uuid.NewString(), userID, targetID); err != nil {
		serverError(w, "Erreur blocage:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

// POST /friends/{userId}/unblock
func (h *handlers) unblock(w http.ResponseWriter, r *http.Request) {
	if _, err := h.db.Exec(r.Context(),
		"DELETE FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?",
		platform.UserID(r), r.PathValue("userId"), "blocked"); err != nil {
		serverError(w, "Erreur déblocage:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

// GET /friends/blocked
func (h *handlers) blocked(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Rows(r.Context(),
		`SELECT f.friend_id as id, u.username, u.display_name as displayName, u.avatar_url as avatarUrl
       FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = 'blocked'`, platform.UserID(r))
	if err != nil {
		serverError(w, "Erreur récupération bloqués:", err)
		return
	}
	platform.JSON(w, 200, rows)
}

// GET /friends/block-status/{otherId}
func (h *handlers) blockStatus(w http.ResponseWriter, r *http.Request) {
	userID, otherID := platform.UserID(r), r.PathValue("otherId")
	rows, err := h.db.Rows(r.Context(),
		`SELECT user_id, friend_id FROM friends
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
       AND status = 'blocked'`,
		userID, otherID, otherID, userID)
	if err != nil {
		serverError(w, "Erreur vérification blocage:", err)
		return
	}
	iBlockedThem, theyBlockedMe := false, false
	for _, row := range rows {
		if row.Str("user_id") == userID {
			iBlockedThem = true
		}
		if row.Str("user_id") == otherID {
			theyBlockedMe = true
		}
	}
	platform.JSON(w, 200, platform.O("iBlockedThem", iBlockedThem, "theyBlockedMe", theyBlockedMe))
}

// GET /friends/mutual/{otherId} — amis en commun + relation (popup de profil).
func (h *handlers) mutual(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID, otherID := platform.UserID(r), r.PathValue("otherId")
	if otherID == userID {
		platform.JSON(w, 200, platform.O("mutualFriends", []any{}, "friendState", "friends"))
		return
	}

	mine, err := h.friendIDsOf(ctx, userID)
	if err != nil {
		serverError(w, "Erreur amis en commun:", err)
		return
	}
	theirs, err := h.friendIDsOf(ctx, otherID)
	if err != nil {
		serverError(w, "Erreur amis en commun:", err)
		return
	}
	theirSet := make(map[string]bool, len(theirs))
	for _, id := range theirs {
		theirSet[id] = true
	}
	var mutualIDs []string
	for _, id := range mine {
		if theirSet[id] {
			mutualIDs = append(mutualIDs, id)
		}
	}
	users, err := h.fetchUsersByIds(ctx, mutualIDs)
	if err != nil {
		serverError(w, "Erreur amis en commun:", err)
		return
	}

	// Statut de relation (les lignes 'blocked' sont gérées par /block-status).
	rel, err := h.db.Rows(ctx,
		`SELECT user_id, status FROM friends
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
         AND status IN ('pending', 'accepted')`,
		userID, otherID, otherID, userID)
	if err != nil {
		serverError(w, "Erreur amis en commun:", err)
		return
	}
	friendState := "none"
	for _, row := range rel {
		if row.Str("status") == "accepted" {
			friendState = "friends"
			break
		}
		if row.Str("user_id") == userID {
			friendState = "pending_sent"
		} else {
			friendState = "pending_received"
		}
	}
	platform.JSON(w, 200, platform.O("mutualFriends", pick(mutualIDs, users), "friendState", friendState))
}
