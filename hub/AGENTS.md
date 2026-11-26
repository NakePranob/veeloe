# Agent Guidance: hub

The Veeloe Hub: a modular monolith in Go (Gin, GORM, Postgres). Each business
capability is a module under `internal/app/<name>/`; `cmd/api/wiring.go` is the
process composition root (ADR 0014). The structure is held by
`internal/archtest`, whose rules are in `.conventions/rules.json` (ADR 0070).
go-scaffold made the first modules; its CLI and `go-scaffold check` are no longer
used.

## Structure

Before editing a module, read `.conventions/rules.json` and the ADRs it names.

- **Add a module:** `/keel:add-unit`. It copies `.conventions/templates/table-module`
  (a module that owns a table, from `machine`) or `no-table-module` (from
  `relay`), renames it, and wires it in `cmd/api/wiring.go`.
- **Change a module, even slightly:** `/keel:change-unit`.
- Inside a module, dependencies point inward:
  - `adapters/inbound/http`: handlers and their DTOs; another transport gets
    its own folder beside `http`
  - `application`: the use cases
  - `domain`: entities and rules, with no Gin, GORM or HTTP
  - `ports`: the interfaces the application needs
  - `adapters/outbound/postgres` or `memory`: the ports' implementations
- A module never imports another module. `internal/composition/` adapts one
  module for another and imports only a module's root package.
- Shared code lives in `internal/shared/<pkg>` and `internal/platform/<pkg>`.
  Nothing under `internal/` imports `cmd/`.

`go test ./internal/archtest/` checks all of this and names the rule it
broke; `bun run check` at the repo root runs it with the other halves.

## Schema

- The schema comes from `migrations/` in every environment. `cmd/api/wiring.go`
  only checks the applied version; never add `db.AutoMigrate` or schema changes
  at startup.
- A schema change is a reviewed pair, `<UTC timestamp>_<name>.up.sql` and
  `.down.sql` (`migrate create -ext sql -dir migrations -seq=false <name>`).
  Write the SQL first, the Go struct second. archtest refuses an up without
  its down.
- A destructive change takes two deploys: expand (add the new shape, write
  both), deploy, then contract (drop the old one). Renaming, dropping or
  changing a column's type is always two.
- Never run `make migrate-verify` (up, down -all, up) against a database whose
  data matters.

## Runtime safety

- `APP_ENV` is `development` or `production`, and is the only environment gate.
- External resources are owned and closed by their composition root; keep the
  signal-driven graceful shutdown and never `os.Exit` from a goroutine.
- Liveness never fails on a dependency; readiness may.
- Return a stable, generic error to clients and wrap the cause with
  `apperror.NewInternal(cause)` so middleware logs it with `request_id`.
- The Hub has no password auth, JWT or RBAC: Controllers and Machines prove a
  key (ADR 0013), and the Runtime decides permissions (ADR 0010).

## Verify

```bash
gofmt -l .
go vet ./...
go test ./...
go test -race ./...    # for concurrency and relay changes
```

The real-store tests need a migrated disposable Postgres in `TEST_DB_DSN` and
`REQUIRE_TEST_DB=true`; a skipped test is not a pass.
