// ==========================================
// ALFYCHAT - MIDDLEWARE D'AUTHENTIFICATION
// ==========================================

package platform

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// Auth vérifie les secrets au démarrage et protège les routes.
type Auth struct {
	jwtSecret      []byte
	internalSecret string
}

// NewAuth refuse de démarrer sans JWT_SECRET ni INTERNAL_SECRET.
func NewAuth() *Auth {
	return &Auth{
		jwtSecret:      []byte(MustEnv("JWT_SECRET")),
		internalSecret: MustEnv("INTERNAL_SECRET"),
	}
}

// SafeCompare compare deux secrets en temps constant.
func SafeCompare(a, b string) bool {
	if a == "" || b == "" || len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// IsInternal vaut vrai si la requête porte le bon x-internal-secret.
func (a *Auth) IsInternal(r *http.Request) bool {
	return SafeCompare(r.Header.Get("X-Internal-Secret"), a.internalSecret)
}

// InternalSecret renvoie le secret partagé avec le gateway.
func (a *Auth) InternalSecret() string { return a.internalSecret }

// Require : bypass interne (x-internal-secret + x-user-id venant du gateway),
// sinon JWT HS256 dans Authorization: Bearer.
func (a *Auth) Require(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.IsInternal(r) {
			if uid := r.Header.Get("X-User-Id"); uid != "" {
				next(w, WithUserID(r, uid))
				return
			}
		}

		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			Error(w, http.StatusUnauthorized, "Token d'authentification requis")
			return
		}
		claims, err := a.Verify(strings.Replace(header, "Bearer ", "", 1))
		if err != nil {
			if errors.Is(err, jwt.ErrTokenExpired) {
				Error(w, http.StatusUnauthorized, "Token expiré")
				return
			}
			Error(w, http.StatusUnauthorized, "Token invalide")
			return
		}
		uid, _ := claims["userId"].(string)
		if uid == "" {
			Error(w, http.StatusUnauthorized, "Token invalide")
			return
		}
		next(w, WithUserID(r, uid))
	}
}

// Verify valide un JWT HS256 et renvoie ses claims.
func (a *Auth) Verify(token string) (jwt.MapClaims, error) {
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) {
		return a.jwtSecret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, err
	}
	return claims, nil
}

// WithUserID attache l'utilisateur authentifié à la requête.
func WithUserID(r *http.Request, uid string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), ctxUserID, uid))
}

// UserID renvoie l'utilisateur authentifié.
func UserID(r *http.Request) string {
	uid, _ := r.Context().Value(ctxUserID).(string)
	return uid
}
