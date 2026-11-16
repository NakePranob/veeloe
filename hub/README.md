# hub

The Veeloe Hub: Gin + GORM on Postgres, schema managed with
[golang-migrate](https://github.com/golang-migrate/migrate). Each business
capability is a module under `internal/app/<name>/` with a hexagonal inside
(ADR 0014, 0070). It began from go-scaffold; that CLI is no longer used, and
`internal/archtest` holds the structure (`.conventions/rules.json`).

A new module copies `.conventions/templates/table-module` (it owns a table) or
`no-table-module` (it does not), renamed; see `AGENTS.md`.

## Layout

```
cmd/
├── api/
│   ├── main.go                # process entry point, config, slog, graceful shutdown
│   └── wiring.go              # process composition root and route registration
internal/
├── composition/               # cross-feature adapters and process-level wiring
├── platform/                  # adapters for external systems
│   └── database/              # opens the PostgreSQL connection + pool
├── shared/                    # pure logic/framework glue, no I/O
│   ├── config/                # loads config from env
│   ├── apperror/              # central error type (status + payload)
│   ├── dberr/                 # maps DB errors to constraint kind — shared by every domain
│   ├── id/                    # UUID v7 generation (id.New)
│   ├── middleware/            # RequestID, Logger, Error, CORS
│   └── tx/                    # carries a transaction on the context
└── app/                       # one package per domain, added with `generate module`
```

The tree shows the baseline. Installed optional features add the process and
platform packages listed in the section above without changing these module
boundaries.

Cross-feature adapters belong in `internal/composition/`, not in `cmd/api/`.
The API wiring file selects infrastructure, invokes those adapters, and
registers routes. Keep one-way dependencies and expose only narrow public
capabilities from each feature.

Optional features stay in the same architecture: auth owns user application
use cases and provider ports, RBAC owns role policy, worker owns queue/mail
adapters, and observability owns metrics/tracing setup.

## Run

```bash
make docker-up                     # local Postgres (postgres:5432)
make db-create                     # create the hub database itself (once — safe to re-run)
go mod tidy

make run                           # needs `make migrate-up` first — the schema is the migrations'
```

To pair a phone rather than the Simulator, the Hub must be reachable at the URL
it advertises, because that URL is inside every handshake signature
(ADR 0013): start it with `HUB_PUBLIC_URL=ws://<this machine's LAN IP>:8080
make run` (or `wss://…` behind TLS), and give `veeloe pair --hub` the same URL.
The development default, `ws://localhost:<PORT>`, only works for clients on
this machine, such as the Simulator.

`make run`/`make test`/`make migrate-up`/`make migrate-down` load `.env` if
present (copy `.env.example` to `.env` to override defaults — the app itself
just reads `os.Getenv`, no `.env` parsing at runtime). Point them at another
file with `ENV_FILE`: copy `.env.example` to `.env.production`, fill it in,
then `make run ENV_FILE=.env.production`. Trailing `# ...` comments in the env
file are stripped before loading, so a `# prod: ...` note next to a value is
safe; a `#` inside a value (password, DSN) is kept.

`make db-create` connects to Postgres at `DB_HOST`/`DB_PORT`/`DB_USER` (default:
`localhost`/`5432`/`postgres`, matching `.env.example`) using the `psql`
client — works the same whether Postgres came from
`make docker-up` or an existing instance you already have
running. Override any of
`DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`PGPASSWORD` to point at a different
server. If `psql` isn't installed locally and `DB_HOST` is `localhost`, it
falls back to `docker exec` into whichever container is publishing
`DB_PORT` — this project's own Postgres (`make docker-up` first) or any
other Postgres container you already have running.

Server listens on `:8080` (override with `PORT`). Ctrl+C = graceful shutdown.

## Makefile

```bash
make run            # go run ./cmd/api
make build          # go build -o bin/api ./cmd/api
make test           # go test ./...
make fmt            # gofmt -w .
make vet            # go vet ./...
make lint           # golangci-lint run (see .golangci.yml)
make tidy           # go mod tidy
make tools          # install pinned migrate and golangci-lint tools
make db-create       # create the database itself (safe to re-run)
make db-drop         # drop the database
make migrate-up      # apply migrations (reads DB_DSN from ENV_FILE)
make migrate-up-test  # same migrations, applied to TEST_DB_DSN instead — see Tests
make migrate-down     # roll back one migration
make migrate-verify   # up -> down-to-zero -> up, catches a broken down.sql (point DB_DSN at a throwaway DB)
make docker-up       # docker compose up -d
make docker-down     # docker compose down
```

## Migrations

Schema is managed with [golang-migrate](https://github.com/golang-migrate/migrate), files live in `migrations/`, named `<version>_<name>.{up,down}.sql`. `version` is a 14-digit UTC timestamp, not an incrementing counter — two people adding a migration off the same base branch get different filenames instead of both claiming the same number and colliding on merge.

```bash
brew install golang-migrate
# or: go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

migrate -path migrations -database "$DB_DSN" up
migrate -path migrations -database "$DB_DSN" down 1
migrate create -ext sql -dir migrations -seq=false add_something   # writes the up/down pair; archtest refuses an up without its down
```

**Every environment:** the schema comes from `migrations/`. Nothing
bootstraps or mutates it at startup; run `migrate up` as its own step —
versioned and rollback-capable — and the app refuses to boot until you have.

In production, the app checks the DB's applied migration version
against the migration files baked into the binary (embedded at build time)
before it starts serving traffic — a stale or half-applied schema fails fast
at boot with a clear message, instead of failing later on whatever query
happens to hit the missing column first:

```text
DB schema is at migration 3, this binary expects 5 — run `make migrate-up`
```

```bash
make migrate-verify   # up -> down-to-zero -> up, catches a broken down.sql before you actually need a rollback (point DB_DSN at a throwaway DB first — this drops every table)
```

## Env vars

| var | default | notes |
|---|---|---|
| `APP_ENV` | `development` in `.env.example` | auth-enabled projects must set it explicitly; use `production` for deployment. It is the prod gate and rejects unknown values |
| `PORT` | `8080` | |
| `DB_DSN` | `postgres://postgres:postgres@localhost:5432/hub?sslmode=disable` | used by both GORM and the `migrate` CLI |
| `LOG_LEVEL` | `info` | debug/info/warn/error |
| `DB_MAX_OPEN_CONNS` | `10` | |
| `DB_MAX_IDLE_CONNS` | `10` | |
| `DB_CONN_MAX_LIFETIME_MIN` | `5` | minutes |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | comma-separated frontend origins allowed to call this API with credentials (cookies) |

The Hub has no password auth: Controllers and Machines prove a key (ADR 0013).

## Tests

Handler and service tests are fast unit tests: handlers depend on a narrow
service interface, and services use function-backed repository stubs. Neither
suite requires a database.

Repository integration tests run against a **real Postgres** instance using
the same versioned SQL migrations as production, each test in a transaction
that's rolled back. Locally they skip when `TEST_DB_DSN` is unset; CI sets
`REQUIRE_TEST_DB=true`, so a missing or unmigrated database fails instead of
becoming a false-green skip. Use a separate `hub_test` database:

```bash
make docker-up      # local postgres first
make db-create DB_NAME=hub_test
make migrate-up-test
TEST_DB_DSN=postgres://postgres:postgres@localhost:5432/hub_test?sslmode=disable REQUIRE_TEST_DB=true go test ./...
```


## Error payload

```json
{"error":{"code":"VALIDATION_ERROR","message":"invalid input","details":{"email":"email"},"request_id":"a1b2..."}}
```

`code` is machine-readable, `details` names the field that failed, `request_id` correlates with server logs (header `X-Request-ID`). `details` is **only returned outside production** (`APP_ENV` != `production`) — in prod it's stripped from every error so a direct caller can't learn the API's shape; the server log still has the full detail keyed by `request_id`.

## API spec

`docs/openapi.yaml` is hand-written and split across sibling files (`common/`, `health/`, per-domain folders) via relative `$ref`. **The server never serves it** — there is no `/docs` route, in any environment, so the API surface and `docs/architect/`'s internal notes stay off the wire. Update the spec by hand whenever an endpoint/DTO changes.

To open it in a renderer (Scalar, Swagger UI, Redoc) or a client generator (Hey API), bundle it into one fully-resolved file and point the tool at that file. Bundling is also what importers that don't resolve external `$ref`s need — they read the index as-is and see zero routes (Bruno's "Import Collection" does this; some Postman flows too):

```bash
make openapi-bundle          # writes docs/openapi.bundled.yaml (gitignored — regenerate anytime)
```

Then open `docs/openapi.bundled.yaml` — it needs no network and no running server.

## Adding a domain

Copy `.conventions/templates/table-module` (or `no-table-module` for a module
that owns no table) to `internal/app/<name>/`, rename `machine`/`relay` in it,
wire it in `cmd/api/wiring.go` and, when it talks to another module,
`internal/composition/`. A table gets its migration pair in `migrations/`.
`go test ./internal/archtest/` checks the result (ADR 0070).

## Deploying

The Hub is one long-running `cmd/api` image; it has no worker (ADR 0014).

Both stages are distroless and run as `nonroot`, so there is no shell in either
image. Debug against the `build` stage instead:
`docker run --rm -it --entrypoint sh $(docker build -q --target build .)`.

`cmd/api` serves HTTP.

Before the first deploy of a release:

| | |
|---|---|
| `APP_ENV` | `production` | production hides internal error details; the applied migration version is required in every environment |
| migrations | `migrate -path migrations -database "$DB_DSN" up` as its own step, before the new binaries roll |
| `TRUSTED_PROXIES` | the CIDRs of your ingress; otherwise ClientIP-based rate limiting and audit decisions may be spoofable |
| `COOKIE_SECURE` | `true` · `COOKIE_SAMESITE=none` as well if your frontend is on a different site |
| `/metrics` | registered only outside production; expose a protected scrape target deliberately if production needs one |

The migration check is what makes the rollout order safe: a binary whose
embedded migrations are ahead of the database refuses to start, while one
that's behind logs a warning and serves — so migrating first, then rolling, is
the order that never leaves a pod serving against a schema it doesn't know.
