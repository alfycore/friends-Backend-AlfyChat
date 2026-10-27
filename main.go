// ==========================================
// ALFYCHAT - SERVICE AMIS
// ==========================================

package main

import (
	"context"
	"log/slog"

	"github.com/alfychat/friends/internal/friends"
	"github.com/alfychat/friends/internal/platform"
)

func main() {
	platform.LoadEnv()
	platform.InitLogger()

	srv := platform.NewServer()
	auth := platform.NewAuth()

	db, err := platform.OpenDatabase()
	if err != nil {
		platform.Fatal("Erreur au démarrage", err)
	}
	if err := friends.Migrate(context.Background(), db); err != nil {
		platform.Fatal("Erreur au démarrage", err)
	}

	friends.Register(srv, db, auth)

	port := platform.Env("PORT", "3003")
	err = srv.Listen(port, func() {
		slog.Info("🚀 Service Friends démarré sur le port " + port)
		platform.StartServiceRegistration("friends")
	})
	if err != nil {
		platform.Fatal("Erreur au démarrage", err)
	}
}
